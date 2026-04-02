/**
 * Dispatch bundle writer — materializes the filesystem handoff artifacts
 * for a governed turn assignment.
 *
 * Per the frozen spec (§46), a dispatch bundle lives at:
 *   .agentxchain/dispatch/turns/<turn_id>/
 *
 * And contains:
 *   - ASSIGNMENT.json  — machine-readable turn envelope
 *   - PROMPT.md        — rendered role prompt with protocol rules
 *   - CONTEXT.md       — execution context (state, last turn, blockers, gates)
 *
 * This module is a library primitive. The resume command and future
 * orchestrator turn loop call it after assignGovernedTurn().
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { getActiveTurn, getActiveTurns } from './governed-state.js';
import {
  DISPATCH_INDEX_PATH,
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingResultPath,
} from './turn-paths.js';

const HISTORY_PATH = '.agentxchain/history.jsonl';

// Reserved paths that agents must never modify
const RESERVED_PATHS = [
  '.agentxchain/state.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
  '.agentxchain/lock.json',
];

/**
 * Write a dispatch bundle for the currently assigned turn.
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state (must have current_turn)
 * @param {object} config - normalized config
 * @param {object} [opts]
 * @param {string} [opts.turnId]
 * @param {string[]} [opts.warnings]
 * @returns {{ ok: boolean, error?: string, bundlePath?: string, warnings?: string[] }}
 */
export function writeDispatchBundle(root, state, config, opts = {}) {
  const targetTurn = resolveTargetTurn(state, opts.turnId);
  if (!targetTurn) {
    return { ok: false, error: 'No active turn in state — cannot write dispatch bundle' };
  }

  const turn = targetTurn;
  const roleId = turn.assigned_role;
  const role = config.roles?.[roleId];

  if (!role) {
    return { ok: false, error: `Role "${roleId}" not found in config` };
  }

  const phase = state.phase;
  const routing = config.routing?.[phase];
  const allowedNextRoles = routing?.allowed_next_roles || [];
  const exitGate = routing?.exit_gate;
  const gateConfig = exitGate ? config.gates?.[exitGate] : null;

  const bundleDir = join(root, getDispatchTurnDir(turn.turn_id));
  const warnings = [...(opts.warnings || [])];

  // Clear and recreate only the targeted turn bundle
  try {
    rmSync(bundleDir, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: `Failed to clear existing dispatch bundle: ${err.message}` };
  }
  mkdirSync(bundleDir, { recursive: true });

  const activeTurns = getActiveTurns(state);
  const activeSiblings = Object.values(activeTurns)
    .filter((activeTurn) => activeTurn.turn_id !== turn.turn_id)
    .map((activeTurn) => ({
      turn_id: activeTurn.turn_id,
      role: activeTurn.assigned_role,
      status: activeTurn.status,
      assigned_sequence: activeTurn.assigned_sequence ?? null,
      declared_file_scope: activeTurn.declared_file_scope,
    }));

  // 1. ASSIGNMENT.json
  const assignment = {
    run_id: state.run_id,
    turn_id: turn.turn_id,
    phase,
    role: roleId,
    runtime_id: turn.runtime_id,
    write_authority: role.write_authority,
    accepted_integration_ref: state.accepted_integration_ref,
    staging_result_path: getTurnStagingResultPath(turn.turn_id),
    reserved_paths: RESERVED_PATHS,
    allowed_next_roles: allowedNextRoles,
    attempt: turn.attempt,
    deadline_at: turn.deadline_at,
    assigned_sequence: turn.assigned_sequence ?? null,
    budget_reservation_usd: state.budget_reservations?.[turn.turn_id]?.reserved_usd ?? null,
    active_siblings: activeSiblings,
  };
  if (turn.conflict_context) {
    assignment.conflict_context = turn.conflict_context;
  }
  if (warnings.length > 0) {
    assignment.advisory_warnings = warnings.map((message) => ({ code: 'advisory_scope_overlap', message }));
  }

  writeFileSync(
    join(root, getDispatchAssignmentPath(turn.turn_id)),
    JSON.stringify(assignment, null, 2) + '\n'
  );

  // 2. PROMPT.md
  const prompt = renderPrompt(role, roleId, turn, state, config, root);
  warnings.push(...prompt.warnings);
  writeFileSync(join(root, getDispatchPromptPath(turn.turn_id)), prompt.content);

  // 3. CONTEXT.md
  const context = renderContext(state, config, root);
  warnings.push(...context.warnings);
  writeFileSync(join(root, getDispatchContextPath(turn.turn_id)), context.content);

  writeDispatchIndex(root, state, warningsByTurnId(state, turn.turn_id, warnings));

  return warnings.length
    ? { ok: true, bundlePath: bundleDir, warnings }
    : { ok: true, bundlePath: bundleDir };
}

// ── Prompt Rendering ────────────────────────────────────────────────────────

function renderPrompt(role, roleId, turn, state, config, root) {
  const phase = state.phase;
  const routing = config.routing?.[phase];
  const exitGate = routing?.exit_gate;
  const gateConfig = exitGate ? config.gates?.[exitGate] : null;
  const warnings = [];

  // Load custom prompt template from disk (best-effort)
  const promptPath = config.prompts?.[roleId];
  let customPrompt = '';
  if (promptPath) {
    try {
      const absPromptPath = join(root, promptPath);
      if (existsSync(absPromptPath)) {
        customPrompt = readFileSync(absPromptPath, 'utf8').trim();
      }
    } catch (err) {
      warnings.push(`Failed to load prompt template "${promptPath}": ${err.message}`);
    }
  }

  const lines = [];

  // Identity block
  lines.push(`# Turn Assignment: ${role.title} (${roleId})`);
  lines.push('');
  lines.push(`**Run:** ${state.run_id}`);
  lines.push(`**Turn:** ${turn.turn_id}`);
  lines.push(`**Phase:** ${phase}`);
  lines.push(`**Attempt:** ${turn.attempt}`);
  lines.push(`**Write Authority:** ${role.write_authority}`);
  lines.push(`**Runtime:** ${turn.runtime_id}`);
  lines.push('');

  // Mandate
  lines.push('## Your Mandate');
  lines.push('');
  lines.push(role.mandate);
  lines.push('');

  // Protocol rules
  lines.push('## Protocol Rules');
  lines.push('');
  lines.push('You MUST follow these rules:');
  lines.push('');
  lines.push('1. **Challenge the previous turn explicitly.** Do not rubber-stamp prior work.');
  lines.push('2. **Do not claim verification you did not perform.** If you did not run the tests, do not say they pass.');
  lines.push('3. **Do not modify reserved state files.** These are orchestrator-owned:');
  for (const p of RESERVED_PATHS) {
    lines.push(`   - \`${p}\``);
  }
  lines.push(`4. **Emit a structured turn result** to \`${getTurnStagingResultPath(turn.turn_id)}\`.`);
  lines.push('5. **Propose the next role**, but do not assume routing authority.');
  lines.push('');

  if (role.write_authority === 'review_only') {
    lines.push('### Write Authority: review_only');
    lines.push('');
    lines.push('- You may NOT modify product/code files.');
    lines.push('- You may create/modify files under `.planning/` and `.agentxchain/reviews/`.');
    lines.push('- Your artifact type must be `review`.');
    lines.push('- You MUST raise at least one objection (even if minor).');
    lines.push('');
  } else if (role.write_authority === 'authoritative') {
    lines.push('### Write Authority: authoritative');
    lines.push('');
    lines.push('- You may directly modify repository files.');
    lines.push('- Your artifact type should be `workspace` or `commit`.');
    lines.push('- You must accurately declare all files you changed.');
    lines.push('');
  } else if (role.write_authority === 'proposed') {
    lines.push('### Write Authority: proposed');
    lines.push('');
    lines.push('- You may propose changes as patches but cannot directly commit.');
    lines.push('- Your artifact type should be `patch`.');
    lines.push('');
  }

  // Gate requirements
  if (gateConfig) {
    lines.push('## Phase Exit Gate');
    lines.push('');
    lines.push(`Gate: \`${exitGate}\``);
    lines.push('');
    if (gateConfig.requires_files) {
      lines.push('Required files:');
      for (const f of gateConfig.requires_files) {
        lines.push(`- \`${f}\``);
      }
    }
    if (gateConfig.requires_verification_pass) {
      lines.push('- Requires verification pass');
    }
    if (gateConfig.requires_human_approval) {
      lines.push('- Requires human approval');
    }
    lines.push('');
  }

  // Retry context
  if (turn.attempt > 1 && turn.last_rejection) {
    lines.push('## Previous Attempt Failed');
    lines.push('');
    lines.push(`This is attempt ${turn.attempt}. The previous attempt was rejected:`);
    lines.push('');
    lines.push(`- **Reason:** ${turn.last_rejection.reason}`);
    lines.push(`- **Failed stage:** ${turn.last_rejection.failed_stage}`);
    if (turn.last_rejection.validation_errors?.length) {
      lines.push('- **Errors:**');
      for (const err of turn.last_rejection.validation_errors) {
        lines.push(`  - ${err}`);
      }
    }
    lines.push('');
    lines.push('Fix the issues above before proceeding.');
    lines.push('');
  }

  if (turn.conflict_context) {
    lines.push('## File Conflict - Retry Required');
    lines.push('');
    lines.push('Your prior attempt conflicted with work accepted after your assignment.');
    lines.push('');
    if (turn.conflict_context.conflicting_files?.length) {
      lines.push('Conflicting files:');
      for (const file of turn.conflict_context.conflicting_files) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }
    if (turn.conflict_context.accepted_turns_since?.length) {
      lines.push('Accepted turns since assignment:');
      for (const acceptedTurn of turn.conflict_context.accepted_turns_since) {
        lines.push(`- \`${acceptedTurn.turn_id}\` (${acceptedTurn.role}) touched: ${acceptedTurn.files_changed.join(', ') || '(none)'}`);
      }
      lines.push('');
    }
    if (turn.conflict_context.non_conflicting_files_preserved?.length) {
      lines.push('Non-conflicting files to preserve from your prior attempt:');
      for (const file of turn.conflict_context.non_conflicting_files_preserved) {
        lines.push(`- \`${file}\``);
      }
      lines.push('');
    }
    lines.push(turn.conflict_context.guidance || 'You MUST rebase your changes on top of the current workspace state before retrying.');
    lines.push('');
  }

  // Role-specific instructions (loaded from custom prompt file)
  if (customPrompt) {
    lines.push('## Role-Specific Instructions');
    lines.push('');
    lines.push(customPrompt);
    lines.push('');
  }

  // Output format with complete JSON template
  lines.push('## Required Output');
  lines.push('');
  lines.push('When your work is complete, write your structured turn result to:');
  lines.push('');
  lines.push('```');
  lines.push(getTurnStagingResultPath(turn.turn_id));
  lines.push('```');
  lines.push('');
  lines.push('The JSON **must** match this exact schema. The orchestrator validates every field.');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(buildTurnResultTemplate(state, turn, roleId, role), null, 2));
  lines.push('```');
  lines.push('');
  lines.push('### Field Rules');
  lines.push('');
  lines.push('- `schema_version`: always `"1.0"`');
  lines.push('- `run_id`, `turn_id`, `role`, `runtime_id`: must match the values above exactly');
  lines.push('- `status`: one of `completed`, `blocked`, `needs_human`, `failed`');
  lines.push('- `summary`: concise description of what you did this turn');
  lines.push('- `decisions[].id`: pattern `DEC-NNN` (increment from previous turn)');
  lines.push('- `decisions[].category`: one of `implementation`, `architecture`, `scope`, `process`, `quality`, `release`');
  lines.push('- `objections[].id`: pattern `OBJ-NNN`');
  lines.push('- `objections[].severity`: one of `low`, `medium`, `high`, `blocking`');
  lines.push('- `verification.status`: one of `pass`, `fail`, `skipped`');
  lines.push('- `artifact.type`: one of `workspace`, `patch`, `commit`, `review`');
  lines.push('- `proposed_next_role`: must be in allowed_next_roles for current phase, or `human`');
  if (role.write_authority === 'review_only') {
    lines.push('- `objections`: **must be non-empty** (challenge requirement for review_only roles)');
  }
  lines.push('- `phase_transition_request`: set to next phase name when gate requirements are met, or `null`');
  lines.push('- `run_completion_request`: set to `true` only in the final phase when ready to ship, or `null`');
  lines.push('- `phase_transition_request` and `run_completion_request` are **mutually exclusive**');
  lines.push('');

  return {
    content: lines.join('\n') + '\n',
    warnings,
  };
}

// ── Context Rendering ───────────────────────────────────────────────────────

function renderContext(state, config, root) {
  const warnings = [];
  const lines = [];

  lines.push('# Execution Context');
  lines.push('');

  // State summary
  lines.push('## Current State');
  lines.push('');
  lines.push(`- **Run:** ${state.run_id}`);
  lines.push(`- **Status:** ${state.status}`);
  lines.push(`- **Phase:** ${state.phase}`);
  lines.push(`- **Integration ref:** ${state.accepted_integration_ref || 'none'}`);
  if (state.budget_status) {
    lines.push(`- **Budget spent:** $${(state.budget_status.spent_usd || 0).toFixed(2)}`);
    if (state.budget_status.remaining_usd != null) {
      lines.push(`- **Budget remaining:** $${state.budget_status.remaining_usd.toFixed(2)}`);
    }
  }
  lines.push('');

  // Last accepted turn summary
  if (state.last_completed_turn_id) {
    const lastTurn = readLastHistoryEntry(root, warnings);
    if (lastTurn) {
      lines.push('## Last Accepted Turn');
      lines.push('');
      lines.push(`- **Turn:** ${lastTurn.turn_id}`);
      lines.push(`- **Role:** ${lastTurn.role}`);
      lines.push(`- **Summary:** ${lastTurn.summary}`);
      if (lastTurn.decisions?.length) {
        lines.push('- **Decisions:**');
        for (const d of lastTurn.decisions) {
          lines.push(`  - ${d.id}: ${d.statement}`);
        }
      }
      if (lastTurn.objections?.length) {
        lines.push('- **Objections:**');
        for (const o of lastTurn.objections) {
          lines.push(`  - ${o.id} (${o.severity}): ${o.statement}`);
        }
      }
      lines.push('');
    }
  }

  // Blockers / escalation
  if (state.blocked_on) {
    lines.push('## Blockers');
    lines.push('');
    lines.push(`- **Blocked on:** ${state.blocked_on}`);
    lines.push('');
  }

  if (state.escalation) {
    lines.push('## Escalation');
    lines.push('');
    lines.push(`- **From:** ${state.escalation.from_role}`);
    lines.push(`- **Reason:** ${state.escalation.reason}`);
    lines.push('');
  }

  // Phase gate requirements
  const phase = state.phase;
  const routing = config.routing?.[phase];
  const exitGate = routing?.exit_gate;
  const gateConfig = exitGate ? config.gates?.[exitGate] : null;

  if (gateConfig?.requires_files) {
    lines.push('## Gate Required Files');
    lines.push('');
    for (const f of gateConfig.requires_files) {
      const exists = existsSync(join(root, f));
      lines.push(`- \`${f}\` — ${exists ? 'exists' : 'MISSING'}`);
    }
    lines.push('');
  }

  // Phase gate status
  if (state.phase_gate_status) {
    lines.push('## Phase Gate Status');
    lines.push('');
    for (const [gate, status] of Object.entries(state.phase_gate_status)) {
      lines.push(`- \`${gate}\`: ${status}`);
    }
    lines.push('');
  }

  return {
    content: lines.join('\n') + '\n',
    warnings,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveTargetTurn(state, turnId) {
  const activeTurns = getActiveTurns(state);
  if (turnId) {
    return activeTurns[turnId] || null;
  }
  return getActiveTurn(state) || state?.current_turn || null;
}

function warningsByTurnId(state, targetTurnId, targetWarnings) {
  const warningMap = {};
  for (const turnId of Object.keys(getActiveTurns(state))) {
    warningMap[turnId] = [];
  }
  if (targetTurnId && targetWarnings?.length) {
    warningMap[targetTurnId] = [...targetWarnings];
  }
  return warningMap;
}

function writeDispatchIndex(root, state, warningsByTurn = {}) {
  const activeTurns = getActiveTurns(state);
  const activeEntries = {};

  for (const [turnId, turn] of Object.entries(activeTurns)) {
    const turnWarnings = warningsByTurn[turnId] || [];
    activeEntries[turnId] = {
      turn_id: turnId,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      attempt: turn.attempt,
      status: turn.status,
      bundle_path: getDispatchTurnDir(turnId),
      staging_result_path: getTurnStagingResultPath(turnId),
      assigned_sequence: turn.assigned_sequence ?? null,
      advisory_warnings: turnWarnings.map((message) => ({
        code: 'advisory_scope_overlap',
        message,
      })),
    };
  }

  mkdirSync(join(root, '.agentxchain/dispatch'), { recursive: true });
  writeFileSync(
    join(root, DISPATCH_INDEX_PATH),
    JSON.stringify(
      {
        run_id: state.run_id,
        phase: state.phase,
        updated_at: new Date().toISOString(),
        active_turns: activeEntries,
      },
      null,
      2,
    ) + '\n',
  );
}

function readLastHistoryEntry(root, warnings = []) {
  const historyPath = join(root, HISTORY_PATH);
  if (!existsSync(historyPath)) return null;
  try {
    const content = readFileSync(historyPath, 'utf8').trim();
    if (!content) return null;
    const lines = content.split('\n');
    return JSON.parse(lines[lines.length - 1]);
  } catch (err) {
    warnings.push(`Failed to read ${HISTORY_PATH}: ${err.message}`);
    return null;
  }
}

// ── Turn Result Template ───────────────────────────────────────────────────

function buildTurnResultTemplate(state, turn, roleId, role) {
  const isReviewOnly = role.write_authority === 'review_only';
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: roleId,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'TODO: describe what you accomplished this turn',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'TODO: describe the decision',
        rationale: 'TODO: explain why',
      },
    ],
    objections: isReviewOnly
      ? [
          {
            id: 'OBJ-001',
            severity: 'medium',
            against_turn_id: state.last_completed_turn_id || 'TODO',
            statement: 'TODO: challenge the previous turn (required for review_only roles)',
            status: 'raised',
          },
        ]
      : [],
    files_changed: isReviewOnly ? [] : ['TODO: list every file you modified'],
    artifacts_created: [],
    verification: {
      status: isReviewOnly ? 'skipped' : 'pass',
      commands: isReviewOnly ? [] : ['TODO: list commands you ran'],
      evidence_summary: isReviewOnly
        ? 'Review turn — no verification commands required.'
        : 'TODO: describe what you verified',
      machine_evidence: isReviewOnly
        ? []
        : [{ command: 'TODO', exit_code: 0 }],
    },
    artifact: {
      type: isReviewOnly ? 'review' : 'workspace',
      ref: isReviewOnly ? null : 'git:dirty',
    },
    proposed_next_role: 'TODO',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: {
      input_tokens: 0,
      output_tokens: 0,
      usd: 0,
    },
  };
}

export { DISPATCH_INDEX_PATH, RESERVED_PATHS, getDispatchTurnDir, getTurnStagingResultPath };
