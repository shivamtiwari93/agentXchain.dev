/**
 * Governed state writers — the accept/reject turn cycle.
 *
 * These are library primitives, not CLI commands. They implement the
 * orchestrator-owned write path from the frozen spec (§39):
 *
 *   - initializeGovernedRun()  — create a run envelope from idle state
 *   - assignGovernedTurn()     — assign a turn to a role
 *   - acceptGovernedTurn()     — validate staged result, promote to accepted state
 *   - rejectGovernedTurn()     — preserve rejected artifact, increment retry or escalate
 *
 * Design rules:
 *   - Only these functions may mutate state.json, history.jsonl, decision-ledger.jsonl
 *   - Accept does NOT auto-assign the next turn (§39.1)
 *   - Reject does NOT append to history or decision ledger (§39.2)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { safeWriteJson } from './safe-write.js';
import { validateStagedTurnResult } from './turn-result-validator.js';
import { evaluatePhaseExit, evaluateRunCompletion } from './gate-evaluator.js';
import {
  captureBaseline,
  observeChanges,
  buildObservedArtifact,
  normalizeVerification,
  compareDeclaredVsObserved,
  deriveAcceptedRef,
  checkCleanBaseline,
} from './repo-observer.js';

// ── Constants ────────────────────────────────────────────────────────────────

const STATE_PATH = '.agentxchain/state.json';
const HISTORY_PATH = '.agentxchain/history.jsonl';
const LEDGER_PATH = '.agentxchain/decision-ledger.jsonl';
const STAGING_PATH = '.agentxchain/staging/turn-result.json';
const TALK_PATH = 'TALK.md';

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function readState(root) {
  const filePath = join(root, STATE_PATH);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(root, state) {
  safeWriteJson(join(root, STATE_PATH), state);
}

function appendJsonl(root, relPath, entry) {
  const filePath = join(root, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  writeFileSync(filePath, line, { flag: 'a' });
}

function appendTalk(root, section) {
  const filePath = join(root, TALK_PATH);
  let existing = '';
  if (existsSync(filePath)) {
    existing = readFileSync(filePath, 'utf8');
  }
  const prefix = existing.endsWith('\n') || existing === '' ? '' : '\n';
  writeFileSync(filePath, existing + prefix + section + '\n');
}

// ── Core Operations ──────────────────────────────────────────────────────────

/**
 * Initialize a governed run from idle state.
 * Creates a run_id and sets status to 'active'.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized config
 * @returns {{ ok: boolean, error?: string, state?: object }}
 */
export function initializeGovernedRun(root, config) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  if (state.status === 'completed') {
    return { ok: false, error: 'Cannot initialize run: this run is already completed. Start a new project or reset state.' };
  }
  if (state.status !== 'idle' && state.status !== 'paused') {
    return { ok: false, error: `Cannot initialize run: status is "${state.status}", expected "idle" or "paused"` };
  }

  const runId = generateId('run');
  const updatedState = {
    ...state,
    run_id: runId,
    status: 'active',
    blocked_on: null,
    budget_status: {
      spent_usd: 0,
      remaining_usd: config.budget?.per_run_max_usd ?? null
    }
  };

  writeState(root, updatedState);
  return { ok: true, state: updatedState };
}

/**
 * Assign a turn to a role.
 * Sets current_turn in state.json.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized config
 * @param {string} roleId - the role to assign
 * @returns {{ ok: boolean, error?: string, state?: object }}
 */
export function assignGovernedTurn(root, config, roleId) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  if (state.status !== 'active') {
    return { ok: false, error: `Cannot assign turn: status is "${state.status}", expected "active"` };
  }
  if (state.current_turn) {
    return { ok: false, error: `Turn already assigned: ${state.current_turn.turn_id} to ${state.current_turn.assigned_role}` };
  }

  const role = config.roles?.[roleId];
  if (!role) {
    return { ok: false, error: `Unknown role: "${roleId}"` };
  }
  const runtimeId = role.runtime_id || role.runtime;
  if (!runtimeId) {
    return { ok: false, error: `Role "${roleId}" has no runtime identifier` };
  }

  // v1 clean-baseline rule: authoritative/proposed turns require a clean working tree
  const writeAuthority = role.write_authority || 'review_only';
  const cleanCheck = checkCleanBaseline(root, writeAuthority);
  if (!cleanCheck.clean) {
    return { ok: false, error: cleanCheck.reason };
  }

  // Capture baseline snapshot for observed diff at acceptance time
  const baseline = captureBaseline(root);

  const turnId = generateId('turn');
  const now = new Date().toISOString();
  const timeoutMinutes = 20;

  const updatedState = {
    ...state,
    current_turn: {
      turn_id: turnId,
      assigned_role: roleId,
      status: 'running',
      attempt: 1,
      started_at: now,
      deadline_at: new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString(),
      runtime_id: runtimeId,
      baseline,
    }
  };

  writeState(root, updatedState);
  return { ok: true, state: updatedState };
}

/**
 * Accept a governed turn.
 *
 * 1. Load current state
 * 2. Validate .agentxchain/staging/turn-result.json
 * 3. Append accepted entry to history.jsonl
 * 4. Append decisions to decision-ledger.jsonl
 * 5. Append prose section to TALK.md
 * 6. Update state.json
 * 7. Clear staging file
 *
 * Does NOT auto-assign the next turn.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized config
 * @returns {{ ok: boolean, error?: string, validation?: object, state?: object }}
 */
export function acceptGovernedTurn(root, config) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  if (!state.current_turn) {
    return { ok: false, error: 'No active turn to accept' };
  }

  // Validate staged turn result (validator reads the file itself)
  const validation = validateStagedTurnResult(root, state, config);
  if (!validation.ok) {
    return {
      ok: false,
      error: `Validation failed at stage ${validation.stage}: ${validation.errors.join('; ')}`,
      validation
    };
  }

  const turnResult = validation.turnResult;
  const stagingFile = join(root, STAGING_PATH);

  const now = new Date().toISOString();

  // ── Orchestrator-derived observation ───────────────────────────────────
  const baseline = state.current_turn?.baseline || null;
  const observation = observeChanges(root, baseline);

  // Derive runtime type for verification normalization
  const role = config.roles?.[turnResult.role];
  const runtimeId = turnResult.runtime_id;
  const runtime = config.runtimes?.[runtimeId];
  const runtimeType = runtime?.type || 'manual';

  // Compare declared vs observed files (artifact validation Stage C extension)
  const writeAuthority = role?.write_authority || 'review_only';
  const diffComparison = compareDeclaredVsObserved(
    turnResult.files_changed || [],
    observation.files_changed,
    writeAuthority,
  );
  if (diffComparison.errors.length > 0) {
    return {
      ok: false,
      error: `Observed artifact mismatch: ${diffComparison.errors.join('; ')}`,
      validation: {
        ...validation,
        ok: false,
        stage: 'artifact_observation',
        error_class: 'artifact_error',
        errors: diffComparison.errors,
        warnings: diffComparison.warnings,
      },
    };
  }

  // Build observed artifact record
  const observedArtifact = buildObservedArtifact(observation, baseline);

  // Normalize verification
  const normalizedVerification = normalizeVerification(turnResult.verification, runtimeType);

  // Derive accepted_integration_ref from orchestrator observation
  const artifactType = turnResult.artifact?.type || 'review';
  const derivedRef = deriveAcceptedRef(observation, artifactType, state.accepted_integration_ref);

  // 1. Append to history.jsonl
  const historyEntry = {
    turn_id: turnResult.turn_id,
    run_id: turnResult.run_id,
    role: turnResult.role,
    runtime_id: turnResult.runtime_id,
    status: turnResult.status,
    summary: turnResult.summary,
    decisions: turnResult.decisions || [],
    objections: turnResult.objections || [],
    files_changed: turnResult.files_changed || [],
    artifacts_created: turnResult.artifacts_created || [],
    verification: turnResult.verification || {},
    normalized_verification: normalizedVerification,
    artifact: turnResult.artifact || {},
    observed_artifact: observedArtifact,
    proposed_next_role: turnResult.proposed_next_role,
    phase_transition_request: turnResult.phase_transition_request,
    cost: turnResult.cost || {},
    accepted_at: now
  };
  appendJsonl(root, HISTORY_PATH, historyEntry);

  // 2. Append decisions to ledger
  if (turnResult.decisions && turnResult.decisions.length > 0) {
    for (const decision of turnResult.decisions) {
      const ledgerEntry = {
        id: decision.id,
        turn_id: turnResult.turn_id,
        role: turnResult.role,
        phase: state.phase,
        category: decision.category,
        statement: decision.statement,
        rationale: decision.rationale,
        objections_against: [],
        status: 'accepted',
        overridden_by: null,
        created_at: now
      };
      appendJsonl(root, LEDGER_PATH, ledgerEntry);
    }
  }

  // 3. Append to TALK.md
  const turnNumber = turnResult.turn_id.replace(/^turn_/, '').slice(0, 8);
  const talkSection = `## Turn ${turnNumber} — ${turnResult.role} (${state.phase})\n\n- **Status:** ${turnResult.status}\n- **Summary:** ${turnResult.summary}\n${turnResult.decisions?.length ? turnResult.decisions.map(d => `- **Decision ${d.id}:** ${d.statement}`).join('\n') + '\n' : ''}${turnResult.objections?.length ? turnResult.objections.map(o => `- **Objection ${o.id} (${o.severity}):** ${o.statement}`).join('\n') + '\n' : ''}- **Proposed next:** ${turnResult.proposed_next_role || 'human'}\n\n---\n`;
  appendTalk(root, talkSection);

  // 4. Update state
  const costUsd = turnResult.cost?.usd || 0;
  const updatedState = {
    ...state,
    last_completed_turn_id: state.current_turn.turn_id,
    current_turn: null,
    blocked_on: turnResult.status === 'needs_human' ? `human:${turnResult.needs_human_reason || 'unspecified'}` : null,
    escalation: null,
    accepted_integration_ref: derivedRef,
    next_recommended_role: deriveNextRecommendedRole(turnResult, state, config),
    budget_status: {
      spent_usd: (state.budget_status?.spent_usd || 0) + costUsd,
      remaining_usd: state.budget_status?.remaining_usd != null
        ? state.budget_status.remaining_usd - costUsd
        : null
    }
  };

  // If status is needs_human, pause the run
  if (turnResult.status === 'needs_human') {
    updatedState.status = 'paused';
  }

  // 5. Evaluate phase exit gate (§40-§43) and run completion
  let gateResult = null;
  let completionResult = null;
  if (turnResult.status !== 'needs_human') {
    // First: check if this is a run completion request
    if (turnResult.run_completion_request) {
      completionResult = evaluateRunCompletion({
        state: { ...state, current_turn: null },
        config,
        acceptedTurn: turnResult,
        root,
      });

      if (completionResult.action === 'complete') {
        // Final gate passes, no human approval → run is done
        updatedState.status = 'completed';
        updatedState.completed_at = new Date().toISOString();
        if (completionResult.gate_id) {
          updatedState.phase_gate_status = {
            ...(updatedState.phase_gate_status || {}),
            [completionResult.gate_id]: 'passed',
          };
        }
      } else if (completionResult.action === 'awaiting_human_approval') {
        // Final gate passes structurally but needs human sign-off
        updatedState.status = 'paused';
        updatedState.blocked_on = `human_approval:${completionResult.gate_id}`;
        updatedState.pending_run_completion = {
          gate: completionResult.gate_id,
          requested_by_turn: turnResult.turn_id,
          requested_at: new Date().toISOString(),
        };
      }
      // gate_failed or not_final_phase: accept turn but don't complete
    } else {
      // Standard phase exit gate evaluation
      gateResult = evaluatePhaseExit({
        state: { ...state, current_turn: null },  // post-acceptance state view
        config,
        acceptedTurn: turnResult,
        root,
      });

      if (gateResult.action === 'advance') {
        // Rule 4: Gate passes, no human approval → advance phase immediately
        updatedState.phase = gateResult.next_phase;
        updatedState.phase_gate_status = {
          ...(updatedState.phase_gate_status || {}),
          [gateResult.gate_id || 'no_gate']: 'passed',
        };
      } else if (gateResult.action === 'awaiting_human_approval') {
        // Rule 5: Gate passes structurally but requires human approval → pause
        updatedState.status = 'paused';
        updatedState.blocked_on = `human_approval:${gateResult.gate_id}`;
        updatedState.pending_phase_transition = {
          from: state.phase,
          to: gateResult.next_phase,
          gate: gateResult.gate_id,
          requested_by_turn: turnResult.turn_id,
        };
      }
      // Rule 3 (gate_failed) and Rule 1 (no_request): stay in current phase, no state change
    }
  }

  writeState(root, updatedState);

  // 6. Clear staging
  try {
    unlinkSync(stagingFile);
  } catch {}

  return {
    ok: true,
    state: updatedState,
    validation,
    accepted: historyEntry,
    gateResult,
    completionResult,
  };
}

/**
 * Reject a governed turn.
 *
 * 1. Preserve the invalid staged artifact under .agentxchain/dispatch/rejected/
 * 2. Increment current_turn.attempt or escalate if retries exhausted
 * 3. Clear staging file
 *
 * Does NOT append to history.jsonl or decision-ledger.jsonl.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized config
 * @param {object} validationResult - validation failure details. Accepts either
 *                                    `{ failed_stage, errors }` or the raw
 *                                    validator shape `{ stage, errors }`.
 * @param {string} [reason] - human-readable rejection reason
 * @returns {{ ok: boolean, error?: string, state?: object, escalated?: boolean }}
 */
export function rejectGovernedTurn(root, config, validationResult, reason) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  if (!state.current_turn) {
    return { ok: false, error: 'No active turn to reject' };
  }

  const maxRetries = config.rules?.max_turn_retries ?? 2;
  const currentAttempt = state.current_turn.attempt || 1;
  const canRetry = currentAttempt < maxRetries;

  // Preserve rejected artifact
  const rejectedDir = join(root, '.agentxchain', 'dispatch', 'rejected');
  mkdirSync(rejectedDir, { recursive: true });

  const stagingFile = join(root, STAGING_PATH);
  if (existsSync(stagingFile)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rejectedFile = join(rejectedDir, `${state.current_turn.turn_id}-attempt-${currentAttempt}-${timestamp}.json`);
    try {
      const content = readFileSync(stagingFile, 'utf8');
      writeFileSync(rejectedFile, content);
    } catch {}
    try { unlinkSync(stagingFile); } catch {}
  }

  // Write rejection context for the next retry
  const rejectionContext = {
    turn_id: state.current_turn.turn_id,
    attempt: currentAttempt,
    rejected_at: new Date().toISOString(),
    reason: reason || 'Validation failed',
    validation_errors: validationResult?.errors || [],
    failed_stage: validationResult?.failed_stage || validationResult?.stage || 'unknown'
  };

  if (canRetry) {
    // Increment attempt and keep the turn assigned
    const updatedState = {
      ...state,
      current_turn: {
        ...state.current_turn,
        attempt: currentAttempt + 1,
        status: 'retrying',
        last_rejection: rejectionContext
      }
    };

    writeState(root, updatedState);
    return { ok: true, state: updatedState, escalated: false };
  }

  // Retries exhausted — escalate
  const updatedState = {
    ...state,
    status: 'paused',
    current_turn: {
      ...state.current_turn,
      status: 'failed',
      last_rejection: rejectionContext
    },
    blocked_on: `escalation:retries-exhausted:${state.current_turn.assigned_role}`,
    escalation: {
      from_role: state.current_turn.assigned_role,
      from_turn_id: state.current_turn.turn_id,
      reason: `Turn rejected ${currentAttempt} times. Retries exhausted.`,
      validation_errors: validationResult?.errors || [],
      escalated_at: new Date().toISOString()
    }
  };

  writeState(root, updatedState);
  return { ok: true, state: updatedState, escalated: true };
}

/**
 * Approve a pending phase transition.
 *
 * When a gate with requires_human_approval passes structurally,
 * the run pauses with a pending_phase_transition. This function
 * advances the phase after explicit human approval.
 *
 * @param {string} root - project root directory
 * @returns {{ ok: boolean, error?: string, state?: object, transition?: object }}
 */
export function approvePhaseTransition(root) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  if (!state.pending_phase_transition) {
    return { ok: false, error: 'No pending phase transition to approve' };
  }
  if (state.status !== 'paused') {
    return { ok: false, error: `Cannot approve transition: status is "${state.status}", expected "paused"` };
  }

  const transition = state.pending_phase_transition;
  const updatedState = {
    ...state,
    phase: transition.to,
    status: 'active',
    blocked_on: null,
    pending_phase_transition: null,
    phase_gate_status: {
      ...(state.phase_gate_status || {}),
      [transition.gate]: 'passed',
    },
  };

  writeState(root, updatedState);

  return {
    ok: true,
    state: updatedState,
    transition,
  };
}

/**
 * Approve a pending run completion.
 *
 * When the final phase gate with requires_human_approval passes structurally,
 * the run pauses with a pending_run_completion. This function marks the run
 * as completed after explicit human approval.
 *
 * @param {string} root - project root directory
 * @returns {{ ok: boolean, error?: string, state?: object, completion?: object }}
 */
export function approveRunCompletion(root) {
  const state = readState(root);
  if (!state) {
    return { ok: false, error: 'No governed state.json found' };
  }
  if (!state.pending_run_completion) {
    return { ok: false, error: 'No pending run completion to approve' };
  }
  if (state.status !== 'paused') {
    return { ok: false, error: `Cannot approve completion: status is "${state.status}", expected "paused"` };
  }

  const completion = state.pending_run_completion;
  const updatedState = {
    ...state,
    status: 'completed',
    completed_at: new Date().toISOString(),
    blocked_on: null,
    pending_run_completion: null,
    phase_gate_status: {
      ...(state.phase_gate_status || {}),
      [completion.gate]: 'passed',
    },
  };

  writeState(root, updatedState);

  return {
    ok: true,
    state: updatedState,
    completion,
  };
}

// ── Routing Helpers ─────────────────────────────────────────────────────────

/**
 * Derive the next recommended role after an accepted turn.
 *
 * Rules:
 *   - If proposed_next_role is routing-legal for the current phase and not 'human', use it
 *   - Otherwise, use the current phase entry_role
 *   - After escalation or human pause, clear recommendation (returns null)
 *
 * @param {object} turnResult — the accepted turn result
 * @param {object} state — the current state
 * @param {object} config — normalized config
 * @returns {string|null}
 */
function deriveNextRecommendedRole(turnResult, state, config) {
  if (turnResult.status === 'needs_human' || turnResult.status === 'blocked') {
    return null;
  }

  const proposed = turnResult.proposed_next_role;
  if (!proposed || proposed === 'human') return null;

  // Check if proposed is routing-legal for the current phase
  const phase = state.phase;
  const routing = config.routing?.[phase];
  if (routing?.allowed_next_roles) {
    if (routing.allowed_next_roles.includes(proposed)) {
      return proposed;
    }
  }

  // Fall back to phase entry_role
  return routing?.entry_role || null;
}

export { STATE_PATH, HISTORY_PATH, LEDGER_PATH, STAGING_PATH, TALK_PATH };
