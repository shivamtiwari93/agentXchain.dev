/**
 * Continuous Vision-Driven Run — lights-out governed execution loop.
 *
 * When the intake queue is empty, derives candidate intents from VISION.md
 * and feeds them through the existing intake pipeline. Chains governed runs
 * back-to-back until max_runs, max_idle_cycles, or operator stop.
 *
 * Spec: .planning/VISION_DRIVEN_CONTINUOUS_SPEC.md
 * Decision: DEC-VISION-CONTINUOUS-001
 */

import { existsSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  resolveVisionPath,
  deriveVisionCandidates,
  deriveRoadmapCandidates,
  detectRoadmapExhaustedVisionOpen,
  captureVisionHeadingsSnapshot,
  computeVisionContentSha,
  buildSourceManifest,
} from './vision-reader.js';
import {
  recordEvent,
  triageIntent,
  approveIntent,
  findNextDispatchableIntent,
  prepareIntentForDispatch,
  consumeNextApprovedIntent,
  resolveIntent,
  buildVisionIdleExpansionSignal,
} from './intake.js';
import { loadProjectContext, loadProjectState } from './config.js';
import { safeWriteJson } from './safe-write.js';
import { emitRunEvent } from './run-events.js';
import { reissueTurn } from './governed-state.js';
import {
  applyGhostRetryAttempt,
  applyGhostRetryExhaustion,
  buildGhostRetryDiagnosticBundle,
  buildGhostRetryExhaustionMirror,
  classifyGhostRetryDecision,
  extractLatestStderrDiagnostic,
} from './ghost-retry.js';
import { getDispatchLogPath, getTurnStagingResultPath } from './turn-paths.js';
import { reconcileOperatorHead } from './operator-commit-reconcile.js';
import { getContinuityStatus } from './continuity-status.js';
import { resolveGovernedRole } from './role-resolution.js';
import {
  archiveStaleIntentsForRun,
  formatLegacyIntentMigrationNotice,
  formatPhantomIntentSupersessionNotice,
} from './intent-startup-migration.js';
import { checkpointAcceptedTurn } from './turn-checkpoint.js';
import {
  hasClaudeAuthenticationFailureText,
  isClaudeLocalCliRuntime,
} from './claude-local-auth.js';

const CONTINUOUS_SESSION_PATH = '.agentxchain/continuous-session.json';
const PRODUCTIVE_TIMEOUT_RETRY_MAX_PER_RUN = 1;
const PRODUCTIVE_TIMEOUT_RETRY_DEADLINE_MINUTES = 60;

function getRoadmapReplenishmentTriageHints(root) {
  const context = loadProjectContext(root);
  const config = context?.config || null;
  return {
    preferred_role: config?.roles?.pm ? 'pm' : null,
    phase_scope: config?.routing?.planning ? 'planning' : null,
  };
}

function formatVisionSectionScope(sections, { limit = 5 } = {}) {
  const names = Array.isArray(sections)
    ? sections.map((section) => String(section || '').trim()).filter(Boolean)
    : [];
  if (names.length === 0) {
    return 'remaining VISION.md scope';
  }
  if (names.length <= limit) {
    return names.join(', ');
  }
  return `${names.slice(0, limit).join(', ')} (+${names.length - limit} more)`;
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export function readContinuousSession(root) {
  const p = join(root, CONTINUOUS_SESSION_PATH);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeContinuousSession(root, session) {
  const dir = join(root, '.agentxchain');
  mkdirSync(dir, { recursive: true });
  safeWriteJson(join(root, CONTINUOUS_SESSION_PATH), session);
}

export function removeContinuousSession(root) {
  const p = join(root, CONTINUOUS_SESSION_PATH);
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // best-effort cleanup
  }
}

function createSession(visionPath, maxRuns, maxIdleCycles, perSessionMaxUsd, currentRunId = null, snapshotOpts = {}) {
  return {
    session_id: `cont-${randomUUID().slice(0, 8)}`,
    started_at: new Date().toISOString(),
    vision_path: visionPath,
    runs_completed: 0,
    max_runs: maxRuns,
    idle_cycles: 0,
    max_idle_cycles: maxIdleCycles,
    current_run_id: currentRunId,
    current_vision_objective: null,
    status: 'running',
    per_session_max_usd: perSessionMaxUsd || null,
    cumulative_spent_usd: 0,
    budget_exhausted: false,
    startup_reconciled_run_id: null,
    // BUG-60 Slice 3: vision snapshot for idle-expansion traceability
    vision_headings_snapshot: snapshotOpts.visionHeadingsSnapshot || null,
    vision_sha_at_snapshot: snapshotOpts.visionShaAtSnapshot || null,
    expansion_iteration: snapshotOpts.expansionIteration ?? 0,
    // Track which vision SHA values have already emitted a stale warning
    _vision_stale_warned_shas: [],
  };
}

function canResumeExistingContinuousSession(session, contOpts) {
  if (!session || typeof session !== 'object') return false;
  if (!['paused', 'running'].includes(session.status)) return false;
  if (session.owner_type === 'schedule') return false;
  if (session.vision_path && session.vision_path !== contOpts.visionPath) return false;
  if (contOpts.continueFrom && session.current_run_id && session.current_run_id !== contOpts.continueFrom) return false;
  return true;
}

function resumeExistingContinuousSession(session, contOpts, initialRunId, snapshotOpts = {}) {
  return {
    ...session,
    vision_path: session.vision_path || contOpts.visionPath,
    max_runs: contOpts.maxRuns,
    max_idle_cycles: contOpts.maxIdleCycles,
    current_run_id: session.current_run_id || initialRunId || null,
    status: session.status === 'paused' ? 'paused' : 'running',
    per_session_max_usd: session.per_session_max_usd ?? contOpts.perSessionMaxUsd ?? null,
    cumulative_spent_usd: session.cumulative_spent_usd || 0,
    budget_exhausted: Boolean(session.budget_exhausted),
    startup_reconciled_run_id: session.startup_reconciled_run_id || null,
    vision_headings_snapshot: session.vision_headings_snapshot || snapshotOpts.visionHeadingsSnapshot || null,
    vision_sha_at_snapshot: session.vision_sha_at_snapshot || snapshotOpts.visionShaAtSnapshot || null,
    expansion_iteration: session.expansion_iteration ?? snapshotOpts.expansionIteration ?? 0,
    _vision_stale_warned_shas: Array.isArray(session._vision_stale_warned_shas)
      ? session._vision_stale_warned_shas
      : [],
  };
}

function describeContinuousTerminalStep(step, contOpts) {
  if (step.action === 'max_runs_reached') {
    return `Max runs reached (${contOpts.maxRuns}). Stopping.`;
  }
  if (step.action === 'session_budget_exhausted') {
    return 'Session budget exhausted. Stopping.';
  }
  if (step.action === 'operator_stopped') {
    return 'Continuous loop stopped by operator.';
  }
  if (step.status === 'idle_exit') {
    return `All vision goals appear addressed (${contOpts.maxIdleCycles} consecutive idle cycles). Stopping.`;
  }
  if (step.status === 'vision_exhausted') {
    return 'PM idle-expansion declared vision exhausted. Stopping.';
  }
  if (step.status === 'vision_expansion_exhausted') {
    return `Idle-expansion cap reached (${contOpts.idleExpansion?.maxExpansions ?? '?'} expansions without productive run). Stopping.`;
  }
  if (step.status === 'failed') {
    const reason = step.stop_reason || step.action || 'unknown';
    return `Continuous loop failed: ${reason}. Check "agentxchain status" for details.`;
  }
  if (step.status === 'blocked') {
    if (step.recovery_action) {
      return `Continuous loop paused on blocker. Recovery: ${step.recovery_action}`;
    }
    return 'Continuous loop paused on blocker. Use "agentxchain unblock <id>" to resume.';
  }
  return null;
}

function getExecutionRunSpentUsd(execution) {
  return execution?.result?.state?.budget_status?.spent_usd || 0;
}

function isBlockedContinuousExecution(execution) {
  const stopReason = execution?.result?.stop_reason || null;
  const stateStatus = execution?.result?.state?.status || null;
  return stateStatus === 'blocked'
    || stopReason === 'blocked'
    || stopReason === 'reject_exhausted';
}

function getAcceptedIdleExpansionEntries(execution) {
  const entries = Array.isArray(execution?.result?.accepted_turn_results)
    ? execution.result.accepted_turn_results
    : [];
  return entries.filter((entry) => entry?.turn_result?.idle_expansion_result);
}

function readIdleExpansionPrompt(root, config) {
  const configuredPath = config?.run_loop?.continuous?.idle_expansion?.pm_prompt_path
    ?? config?.continuous?.idle_expansion?.pm_prompt_path;
  const promptPath = typeof configuredPath === 'string' && configuredPath.trim().length > 0
    ? configuredPath.trim()
    : '.agentxchain/prompts/pm-idle-expansion.md';

  const absPromptPath = join(root, promptPath);
  if (!existsSync(absPromptPath)) {
    return { promptPath, content: '' };
  }

  try {
    return {
      promptPath,
      content: readFileSync(absPromptPath, 'utf8').trim(),
    };
  } catch (err) {
    return {
      promptPath,
      content: '',
      warning: `Failed to load PM idle-expansion prompt "${promptPath}": ${err.message}`,
    };
  }
}

function ingestAcceptedIdleExpansionsFromExecution(context, session, execution, log = console.log) {
  const entries = getAcceptedIdleExpansionEntries(execution);
  if (entries.length === 0) {
    return null;
  }

  let lastIngested = null;
  for (const entry of entries) {
    const ingested = ingestAcceptedIdleExpansion(context, session, {
      turnResult: entry.turn_result,
      historyEntry: entry.accepted || null,
      state: entry.state || execution?.result?.state || null,
    });

    if (!ingested.ingested) {
      session.status = 'failed';
      writeContinuousSession(context.root, session);
      emitRunEvent(context.root, 'idle_expansion_ingestion_failed', {
        run_id: session.current_run_id || null,
        phase: null,
        status: 'failed',
        payload: {
          session_id: session.session_id,
          expansion_iteration: session.expansion_iteration,
          turn_id: entry.turn_id || null,
          error: ingested.error || 'unknown idle-expansion ingestion failure',
        },
      });
      log(`Idle-expansion ingestion failed: ${ingested.error || 'unknown error'}`);
      return {
        ok: false,
        status: 'failed',
        action: 'idle_expansion_ingestion_failed',
        stop_reason: ingested.error || 'idle_expansion_ingestion_failed',
        run_id: session.current_run_id || null,
      };
    }

    lastIngested = ingested;
  }

  if (lastIngested?.kind === 'vision_exhausted') {
    return {
      ok: true,
      status: 'vision_exhausted',
      action: 'idle_expansion_ingested',
      stop_reason: 'vision_exhausted',
      run_id: session.current_run_id || null,
    };
  }

  return {
    ok: true,
    status: 'running',
    action: 'idle_expansion_ingested',
    intent_id: lastIngested?.intentId || null,
    run_id: session.current_run_id || null,
  };
}

function getBlockedRecoveryAction(state) {
  return state?.blocked_reason?.recovery?.recovery_action || null;
}

function getBlockedCategory(state) {
  return state?.blocked_reason?.category || null;
}

const CLAUDE_AUTH_RECOVERY_ACTION =
  'Refresh Claude credentials before resuming: export a valid ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, then run agentxchain step --resume.';

function findRetainedClaudeAuthEscalation(root, state, config) {
  if (!state || state.status !== 'blocked') return null;
  if (state.blocked_reason?.category !== 'retries_exhausted') return null;
  if (typeof state.blocked_on !== 'string' || !state.blocked_on.startsWith('escalation:retries-exhausted:')) {
    return null;
  }
  const turnId = state.blocked_reason?.turn_id || state.escalation?.from_turn_id || null;
  const activeTurns = state.active_turns || {};
  const candidateIds = turnId && activeTurns[turnId] ? [turnId] : Object.keys(activeTurns);
  for (const candidateId of candidateIds) {
    const turn = activeTurns[candidateId];
    if (!turn || turn.status !== 'failed') continue;
    if (turn.last_rejection?.failed_stage !== 'dispatch') continue;
    const runtime = config?.runtimes?.[turn.runtime_id];
    if (!isClaudeLocalCliRuntime(runtime)) continue;
    const stagingPath = join(root, getTurnStagingResultPath(candidateId));
    if (existsSync(stagingPath)) continue;
    const logPath = join(root, getDispatchLogPath(candidateId));
    if (!existsSync(logPath)) continue;
    let logText = '';
    try {
      logText = readFileSync(logPath, 'utf8');
    } catch {
      continue;
    }
    if (!hasClaudeAuthenticationFailureText(logText)) continue;
    return { turn_id: candidateId, turn, previous_blocked_on: state.blocked_on };
  }
  return null;
}

function maybeReclassifyRetainedClaudeAuthEscalation(context, session, state, log = console.log) {
  const { root, config } = context;
  const candidate = findRetainedClaudeAuthEscalation(root, state, config);
  if (!candidate) return null;

  const blockedAt = new Date().toISOString();
  const nextState = {
    ...state,
    status: 'blocked',
    blocked_on: 'dispatch:claude_auth_failed',
    blocked_reason: {
      category: 'dispatch_error',
      blocked_at: blockedAt,
      turn_id: candidate.turn_id,
      reclassified_from: {
        blocked_on: state.blocked_on || null,
        category: state.blocked_reason?.category || null,
      },
      recovery: {
        typed_reason: 'dispatch_error',
        owner: 'human',
        recovery_action: CLAUDE_AUTH_RECOVERY_ACTION,
        turn_retained: true,
        detail: `claude_auth_failed: ${CLAUDE_AUTH_RECOVERY_ACTION}`,
      },
    },
    escalation: null,
  };

  writeGovernedState(root, nextState);
  emitRunEvent(root, 'retained_claude_auth_escalation_reclassified', {
    run_id: nextState.run_id || session.current_run_id || null,
    phase: nextState.phase || null,
    status: 'blocked',
    turn: { turn_id: candidate.turn_id, role_id: candidate.turn.assigned_role || null },
    payload: {
      turn_id: candidate.turn_id,
      previous_blocked_on: candidate.previous_blocked_on,
      blocked_on: nextState.blocked_on,
      runtime_id: candidate.turn.runtime_id || null,
      recovery_action: CLAUDE_AUTH_RECOVERY_ACTION,
    },
  });
  log(`Reclassified retained Claude auth escalation for ${candidate.turn_id} as dispatch:claude_auth_failed.`);
  return nextState;
}

const RECOVERABLE_ACTIVE_TURN_STATUSES = new Set(['assigned', 'dispatched', 'starting', 'running']);

function hasOnlyRecoverableActiveTurns(activeTurns = {}) {
  const turns = Object.values(activeTurns || {});
  if (turns.length === 0) return false;
  return turns.every((turn) => RECOVERABLE_ACTIVE_TURN_STATUSES.has(turn?.status || 'assigned'));
}

export function isPausedContinuousSessionRecoverableActiveRun(session, state, config) {
  if (!session || session.status !== 'paused') return false;
  if (!state || state.status !== 'active') return false;
  if (session.current_run_id && state.run_id && session.current_run_id !== state.run_id) return false;
  if (state.blocked_on || state.blocked_reason || state.escalation) return false;
  if (state.pending_phase_transition || state.pending_run_completion) return false;
  if (state.queued_phase_transition || state.queued_run_completion) return false;
  if (Object.keys(state.active_turns || {}).length > 0) {
    return hasOnlyRecoverableActiveTurns(state.active_turns);
  }

  const resolved = resolveGovernedRole({ state, config });
  return Boolean(resolved?.roleId && !resolved.error);
}

function isPausedActiveRunWaitingOnGovernance(session, state) {
  if (!session || session.status !== 'paused') return false;
  if (!state || state.status !== 'active') return false;
  if (session.current_run_id && state.run_id && session.current_run_id !== state.run_id) return false;
  return true;
}

function recoverPausedActiveContinuousSession(context, session, log = console.log, reason = 'paused_active_run') {
  const latestSession = readContinuousSession(context.root) || session;
  const state = loadProjectState(context.root, context.config);
  if (!isPausedContinuousSessionRecoverableActiveRun(latestSession, state, context.config)) {
    return false;
  }

  Object.assign(session, latestSession, { status: 'running' });
  writeContinuousSession(context.root, session);
  emitRunEvent(context.root, 'continuous_paused_active_run_recovered', {
    run_id: state.run_id || session.current_run_id || null,
    phase: state.phase || null,
    status: state.status || 'active',
    payload: {
      session_id: session.session_id,
      reason,
      next_recommended_role: state.next_recommended_role || null,
    },
  });
  log(`Continuous session was paused while run ${state.run_id || session.current_run_id || '(unknown)'} remained active; resuming next role dispatch.`);
  return true;
}

function writeGovernedState(root, state) {
  safeWriteJson(join(root, '.agentxchain', 'state.json'), state);
}

function clearGhostBlockerAfterReissue(root, state) {
  const nextState = {
    ...state,
    status: 'active',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
  };
  writeGovernedState(root, nextState);
  return nextState;
}

/**
 * Slice 2d (Turn 201): read the per-turn adapter dispatch log and return the
 * most recent stderr excerpt + exit code + signal from `process_exit` or
 * `spawn_error` lines. Best-effort — when the log is missing, unreadable, or
 * contains only spawn_prepare diagnostics, returns a null record so the caller
 * can still record the attempt with the runtime/role/timing fields.
 */
function readLatestDispatchDiagnostic(root, turnId) {
  if (!turnId) return { stderr_excerpt: null, exit_code: null, exit_signal: null };
  try {
    const p = join(root, getDispatchLogPath(turnId));
    if (!existsSync(p)) return { stderr_excerpt: null, exit_code: null, exit_signal: null };
    const content = readFileSync(p, 'utf8');
    return extractLatestStderrDiagnostic(content);
  } catch {
    return { stderr_excerpt: null, exit_code: null, exit_signal: null };
  }
}

function readProductiveTimeoutRetryState(session) {
  const state = session?.productive_timeout_retry;
  if (!state || typeof state !== 'object') {
    return {
      run_id: null,
      attempts: 0,
      max_retries_per_run: PRODUCTIVE_TIMEOUT_RETRY_MAX_PER_RUN,
      last_old_turn_id: null,
      last_new_turn_id: null,
      last_retried_at: null,
      exhausted: false,
    };
  }
  return {
    run_id: state.run_id ?? null,
    attempts: Number.isInteger(state.attempts) && state.attempts >= 0 ? state.attempts : 0,
    max_retries_per_run: Number.isInteger(state.max_retries_per_run)
      ? state.max_retries_per_run
      : PRODUCTIVE_TIMEOUT_RETRY_MAX_PER_RUN,
    last_old_turn_id: state.last_old_turn_id ?? null,
    last_new_turn_id: state.last_new_turn_id ?? null,
    last_retried_at: state.last_retried_at ?? null,
    exhausted: Boolean(state.exhausted),
  };
}

function resetProductiveTimeoutRetryForRun(session, runId) {
  const current = readProductiveTimeoutRetryState(session);
  if (current.run_id === runId) return current;
  return {
    run_id: runId ?? null,
    attempts: 0,
    max_retries_per_run: PRODUCTIVE_TIMEOUT_RETRY_MAX_PER_RUN,
    last_old_turn_id: null,
    last_new_turn_id: null,
    last_retried_at: null,
    exhausted: false,
  };
}

function findPrimaryProductiveTimeoutTurn(root, state) {
  if (!state || typeof state !== 'object') return null;
  if (state.blocked_reason?.category !== 'retries_exhausted') return null;
  const turnId = state.blocked_reason?.turn_id || state.escalation?.from_turn_id || null;
  const activeTurns = state.active_turns || {};
  const candidateIds = turnId && activeTurns[turnId] ? [turnId] : Object.keys(activeTurns);
  for (const candidateId of candidateIds) {
    const turn = activeTurns[candidateId];
    if (!turn || turn.status !== 'failed') continue;
    if (turn.last_rejection?.failed_stage !== 'dispatch') continue;
    const reason = [
      turn.last_rejection?.reason,
      ...(Array.isArray(turn.last_rejection?.validation_errors) ? turn.last_rejection.validation_errors : []),
    ].join('\n');
    const looksDeadlineKilled = /code 143|dispatch timed out|timed out/i.test(reason);
    if (!looksDeadlineKilled) continue;
    if (!turn.first_output_at) continue;
    const stagingPath = join(root, getTurnStagingResultPath(candidateId));
    if (existsSync(stagingPath)) continue;
    return { turn_id: candidateId, turn };
  }
  return null;
}

async function maybeAutoRetryProductiveTimeoutBlocker(context, session, contOpts, blockedState, log = console.log) {
  const { root, config } = context;
  const candidate = findPrimaryProductiveTimeoutTurn(root, blockedState);
  if (!candidate) return null;

  const runId = session.current_run_id || blockedState?.run_id || null;
  const retryState = resetProductiveTimeoutRetryForRun(session, runId);
  const maxRetries = PRODUCTIVE_TIMEOUT_RETRY_MAX_PER_RUN;
  if (retryState.attempts >= maxRetries) {
    Object.assign(session, {
      productive_timeout_retry: {
        ...retryState,
        max_retries_per_run: maxRetries,
        exhausted: true,
      },
      status: 'paused',
    });
    writeContinuousSession(root, session);
    emitRunEvent(root, 'productive_timeout_retry_exhausted', {
      run_id: runId,
      phase: blockedState?.phase || null,
      status: 'blocked',
      turn: { turn_id: candidate.turn_id, role_id: candidate.turn.assigned_role || null },
      intent_id: candidate.turn.intake_context?.intent_id || null,
      payload: {
        turn_id: candidate.turn_id,
        attempts: retryState.attempts,
        max_retries_per_run: maxRetries,
      },
    });
    return null;
  }

  const reissued = reissueTurn(root, config, {
    turnId: candidate.turn_id,
    reason: 'auto_retry_productive_timeout',
  });
  if (!reissued.ok) {
    log(`Productive-timeout auto-retry skipped: ${reissued.error}`);
    return null;
  }

  const nowIso = new Date().toISOString();
  let nextState = clearGhostBlockerAfterReissue(root, reissued.state);
  const deadlineAt = new Date(Date.now() + PRODUCTIVE_TIMEOUT_RETRY_DEADLINE_MINUTES * 60 * 1000).toISOString();
  const activeTurns = { ...(nextState.active_turns || {}) };
  if (activeTurns[reissued.newTurn.turn_id]) {
    activeTurns[reissued.newTurn.turn_id] = {
      ...activeTurns[reissued.newTurn.turn_id],
      deadline_at: deadlineAt,
      timeout_recovery_context: {
        reissued_from: candidate.turn_id,
        reason: 'productive_timeout',
        previous_attempts: candidate.turn.attempt || null,
        previous_deadline_at: candidate.turn.deadline_at || null,
        extended_deadline_minutes: PRODUCTIVE_TIMEOUT_RETRY_DEADLINE_MINUTES,
      },
    };
    nextState = { ...nextState, active_turns: activeTurns };
    writeGovernedState(root, nextState);
  }

  const attempt = retryState.attempts + 1;
  Object.assign(session, {
    productive_timeout_retry: {
      run_id: runId,
      attempts: attempt,
      max_retries_per_run: maxRetries,
      last_old_turn_id: candidate.turn_id,
      last_new_turn_id: reissued.newTurn.turn_id,
      last_retried_at: nowIso,
      exhausted: false,
    },
    status: 'running',
    current_run_id: runId,
  });
  writeContinuousSession(root, session);

  emitRunEvent(root, 'auto_retried_productive_timeout', {
    run_id: runId,
    phase: nextState.phase || blockedState?.phase || null,
    status: 'active',
    turn: { turn_id: reissued.newTurn.turn_id, role_id: reissued.newTurn.assigned_role },
    intent_id: candidate.turn.intake_context?.intent_id || null,
    payload: {
      old_turn_id: candidate.turn_id,
      new_turn_id: reissued.newTurn.turn_id,
      attempt,
      max_retries_per_run: maxRetries,
      extended_deadline_minutes: PRODUCTIVE_TIMEOUT_RETRY_DEADLINE_MINUTES,
    },
  });

  log(`Productive-timeout auto-retried (${attempt}/${maxRetries}): ${candidate.turn_id} -> ${reissued.newTurn.turn_id}`);
  if ((contOpts.cooldownSeconds ?? 0) > 0) {
    await new Promise((resolve) => setTimeout(resolve, contOpts.cooldownSeconds * 1000));
  }
  return {
    ok: true,
    status: 'running',
    action: 'auto_retried_productive_timeout',
    run_id: runId,
    old_turn_id: candidate.turn_id,
    new_turn_id: reissued.newTurn.turn_id,
    attempt,
    max_retries_per_run: maxRetries,
  };
}

async function maybeAutoRetryContinuousBlocker(context, session, contOpts, blockedState, log = console.log) {
  return await maybeAutoRetryProductiveTimeoutBlocker(context, session, contOpts, blockedState, log)
    || await maybeAutoRetryGhostBlocker(context, session, contOpts, blockedState, log);
}

function extractCheckpointTurnIdFromExecution(execution) {
  const errors = Array.isArray(execution?.result?.errors) ? execution.result.errors : [];
  for (const error of errors) {
    const text = String(error || '');
    const match = text.match(/\bcheckpoint-turn\s+--turn\s+(turn_[A-Za-z0-9_-]+)/);
    if (match) return match[1];
  }
  return null;
}

function maybeAutoCheckpointBlockedExecution(context, session, contOpts, execution, log = console.log) {
  if (!contOpts.autoCheckpoint) return null;
  const turnId = extractCheckpointTurnIdFromExecution(execution);
  if (!turnId) return null;

  const checkpoint = checkpointAcceptedTurn(context.root, { turnId });
  if (!checkpoint.ok) {
    log(`Auto-checkpoint skipped for ${turnId}: ${checkpoint.error || 'checkpoint failed'}`);
    return null;
  }
  if (checkpoint.already_checkpointed || checkpoint.skipped) {
    log(`Auto-checkpoint skipped for ${turnId}: ${checkpoint.reason || 'no checkpoint changes were created'}`);
    return null;
  }

  session.status = 'running';
  session.current_run_id = session.current_run_id || execution?.result?.state?.run_id || null;
  writeContinuousSession(context.root, session);

  emitRunEvent(context.root, 'continuous_auto_checkpoint_recovered', {
    run_id: session.current_run_id || execution?.result?.state?.run_id || null,
    phase: execution?.result?.state?.phase || null,
    status: 'active',
    turn: { turn_id: turnId, role_id: null },
    payload: {
      session_id: session.session_id,
      checkpoint_sha: checkpoint.checkpoint_sha || null,
      already_checkpointed: Boolean(checkpoint.already_checkpointed),
      recovered_files_changed: checkpoint.recovered_files_changed || checkpoint.files_changed || null,
    },
  });

  log(`Auto-checkpoint recovered accepted turn ${turnId}; continuing active run.`);
  return {
    ok: true,
    status: 'running',
    action: 'auto_checkpoint_recovered',
    run_id: session.current_run_id,
    turn_id: turnId,
    checkpoint_sha: checkpoint.checkpoint_sha || null,
  };
}

async function maybeAutoRetryGhostBlocker(context, session, contOpts, blockedState, log = console.log) {
  const { root, config } = context;
  const decision = classifyGhostRetryDecision({
    state: blockedState,
    session,
    autoRetryOnGhost: contOpts.autoRetryOnGhost,
    runId: session.current_run_id || blockedState?.run_id || null,
  });

  if (decision.decision === 'retry') {
    const oldTurnId = decision.ghost.turn_id;
    const oldTurn = blockedState?.active_turns?.[oldTurnId] || {};
    const reissued = reissueTurn(root, config, {
      turnId: oldTurnId,
      reason: 'auto_retry_ghost',
    });
    if (!reissued.ok) {
      log(`Ghost auto-retry skipped: ${reissued.error}`);
      return null;
    }

    const runId = session.current_run_id || blockedState?.run_id || reissued.state?.run_id || null;
    const attempt = decision.attempts + 1;
    const nowIso = new Date().toISOString();
    const nextState = clearGhostBlockerAfterReissue(root, reissued.state);
    // Slice 2c: pass runtime/role/timing fields so the fingerprint log can
    // drive same-signature early-stop detection on subsequent invocations.
    const oldRuntimeId = oldTurn.runtime_id || reissued.newTurn.runtime_id || null;
    const oldRoleId = oldTurn.assigned_role || reissued.newTurn.assigned_role || null;
    const oldRunningMs = oldTurn.failed_start_running_ms ?? null;
    const oldThresholdMs = oldTurn.failed_start_threshold_ms ?? null;
    // Slice 2d: pull the adapter's process_exit / spawn_error diagnostic for
    // the ghost turn so the per-attempt log entry is self-contained. Reads
    // the dispatch stdout.log for the OLD turn id; the NEW reissued turn
    // hasn't run yet so has nothing to surface.
    const oldDiag = readLatestDispatchDiagnostic(root, oldTurnId);
    const nextSession = applyGhostRetryAttempt(session, {
      runId,
      oldTurnId,
      newTurnId: reissued.newTurn.turn_id,
      failureType: decision.ghost.failure_type,
      maxRetries: decision.maxRetries,
      nowIso,
      runtimeId: oldRuntimeId,
      roleId: oldRoleId,
      runningMs: oldRunningMs,
      thresholdMs: oldThresholdMs,
      stderrExcerpt: oldDiag.stderr_excerpt,
      exitCode: oldDiag.exit_code,
      exitSignal: oldDiag.exit_signal,
    });
    Object.assign(session, nextSession, {
      status: 'running',
      current_run_id: runId,
    });
    writeContinuousSession(root, session);

    emitRunEvent(root, 'auto_retried_ghost', {
      run_id: runId,
      phase: nextState.phase || blockedState?.phase || null,
      status: 'active',
      turn: { turn_id: reissued.newTurn.turn_id, role_id: reissued.newTurn.assigned_role },
      intent_id: oldTurn.intake_context?.intent_id || null,
      payload: {
        old_turn_id: oldTurnId,
        new_turn_id: reissued.newTurn.turn_id,
        failure_type: decision.ghost.failure_type,
        attempt,
        max_retries_per_run: decision.maxRetries,
        runtime_id: oldTurn.runtime_id || reissued.newTurn.runtime_id || null,
        running_ms: oldTurn.failed_start_running_ms ?? null,
        threshold_ms: oldTurn.failed_start_threshold_ms ?? null,
      },
    });

    log(`Ghost turn auto-retried (${attempt}/${decision.maxRetries}): ${oldTurnId} -> ${reissued.newTurn.turn_id}`);
    if ((contOpts.autoRetryOnGhost?.cooldownSeconds ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, contOpts.autoRetryOnGhost.cooldownSeconds * 1000));
    }
    return {
      ok: true,
      status: 'running',
      action: 'auto_retried_ghost',
      run_id: runId,
      old_turn_id: oldTurnId,
      new_turn_id: reissued.newTurn.turn_id,
      attempt,
      max_retries_per_run: decision.maxRetries,
    };
  }

  if (decision.decision === 'exhausted') {
    const runId = session.current_run_id || blockedState?.run_id || null;
    const oldTurnId = decision.ghost.turn_id;
    const oldTurn = blockedState?.active_turns?.[oldTurnId] || {};
    const manualDetail = blockedState?.blocked_reason?.recovery?.detail
      || blockedState?.blocked_reason?.recovery?.recovery_action
      || null;
    // Slice 2c: build the per-attempt diagnostic bundle from the session's
    // recorded attempts_log. This is the payload the operator needs to
    // decide their next move (bump retries, change runtime, raise watchdog,
    // or file a new bug). Also pass signatureRepeat into the mirror so the
    // status surface distinguishes raw exhaustion from pattern-based early
    // stop.
    const diagnosticBundle = buildGhostRetryDiagnosticBundle(session);
    const signatureRepeat = decision.signatureRepeat || null;
    const detail = buildGhostRetryExhaustionMirror({
      attempts: decision.attempts,
      maxRetries: decision.maxRetries,
      failureType: decision.ghost.failure_type,
      manualRecoveryDetail: manualDetail,
      signatureRepeat,
    });
    const nextState = {
      ...blockedState,
      blocked_reason: {
        ...(blockedState.blocked_reason || {}),
        recovery: {
          ...(blockedState.blocked_reason?.recovery || {}),
          detail,
        },
      },
    };
    writeGovernedState(root, nextState);
    const nextSession = applyGhostRetryExhaustion(session, {
      runId,
      failureType: decision.ghost.failure_type,
      turnId: oldTurnId,
      maxRetries: decision.maxRetries,
      nowIso: new Date().toISOString(),
    });
    Object.assign(session, nextSession, { status: 'paused' });
    writeContinuousSession(root, session);

    emitRunEvent(root, 'ghost_retry_exhausted', {
      run_id: runId,
      phase: blockedState?.phase || null,
      status: 'blocked',
      turn: { turn_id: oldTurnId, role_id: oldTurn.assigned_role || null },
      intent_id: oldTurn.intake_context?.intent_id || null,
      payload: {
        turn_id: oldTurnId,
        attempts: decision.attempts,
        max_retries_per_run: decision.maxRetries,
        failure_type: decision.ghost.failure_type,
        runtime_id: oldTurn.runtime_id || null,
        exhaustion_reason: signatureRepeat ? 'same_signature_repeat' : 'retry_budget_exhausted',
        signature_repeat: signatureRepeat,
        diagnostic_bundle: diagnosticBundle,
        diagnostic_refs: {
          recovery_action: blockedState?.blocked_reason?.recovery?.recovery_action || null,
        },
      },
    });
    const tag = signatureRepeat
      ? `same_signature_repeat [${signatureRepeat.signature}] after ${signatureRepeat.consecutive} attempts`
      : `${decision.attempts}/${decision.maxRetries}`;
    log(`Ghost auto-retry exhausted (${tag}) for ${oldTurnId}.`);
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Intake queue check
// ---------------------------------------------------------------------------

function readIntent(root, intentId) {
  const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
  if (!existsSync(intentPath)) return null;
  try {
    return JSON.parse(readFileSync(intentPath, 'utf8'));
  } catch {
    return null;
  }
}

function buildContinuousProvenance(intentId, options = {}) {
  const { trigger = 'intake', triggerReason = null } = options;
  return {
    trigger,
    intake_intent_id: intentId,
    trigger_reason: triggerReason,
    created_by: 'continuous_loop',
  };
}

export function findNextQueuedIntent(root, options = {}) {
  return findNextDispatchableIntent(root, { run_id: options.run_id || null });
}

/**
 * BUG-62 slice 2: when `run_loop.continuous.reconcile_operator_commits` is
 * `auto_safe_only`, the continuous loop consults the session-checkpoint /
 * governed-state baseline vs current git HEAD before dispatch. If operator
 * commits landed on top of the baseline and the Turn 184 safety primitive
 * accepts them, the baseline is auto-rolled forward so the next dispatch
 * proceeds without manual `agentxchain reconcile-state` intervention. If the
 * safety primitive refuses the commits (governed-state edits or history
 * rewrite), the continuous loop pauses with the refusal class mirrored into
 * `blocked_reason.recovery.detail`, preserving the manual primitive as the
 * operator's single audited safety function per the BUG-62 spec.
 */
export function maybeAutoReconcileOperatorCommits(context, session, contOpts, log = console.log) {
  const mode = contOpts.reconcileOperatorCommits || 'manual';
  if (mode !== 'auto_safe_only') {
    return null;
  }
  const { root } = context;
  const state = loadProjectState(root, context.config);
  const continuity = getContinuityStatus(root, state);
  if (!continuity || continuity.drift_detected !== true) {
    return null;
  }

  const result = reconcileOperatorHead(root, { safetyMode: 'auto_safe_only' });
  if (result.ok) {
    if (result.no_op) {
      return null;
    }
    const acceptedCount = result.accepted_commits?.length || 0;
    log(
      `Operator-commit auto-reconcile accepted ${acceptedCount} commit${acceptedCount === 1 ? '' : 's'} `
      + `(${result.previous_baseline.slice(0, 8)} -> ${result.accepted_head.slice(0, 8)}).`
    );
    return null;
  }

  const errorClass = result.error_class || 'reconcile_refused';
  const detailLines = [
    `Operator-commit auto-reconcile refused (${errorClass}).`,
    result.error || 'Unsafe operator commits detected; manual recovery required.',
    'Run: agentxchain reconcile-state --accept-operator-head once the unsafe changes are resolved, or revert them.',
  ];
  const detail = detailLines.join(' ');

  if (state) {
    const blockedAt = new Date().toISOString();
    const nextState = {
      ...state,
      status: 'blocked',
      blocked_on: state.blocked_on || 'operator_commit_reconcile_refused',
      blocked_reason: {
        ...(state.blocked_reason || {}),
        category: 'operator_commit_reconcile_refused',
        blocked_at: blockedAt,
        turn_id: null,
        error_class: errorClass,
        recovery: {
          ...((state.blocked_reason || {}).recovery || {}),
          typed_reason: 'operator_commit_reconcile_refused',
          owner: 'human',
          recovery_action: 'agentxchain reconcile-state --accept-operator-head',
          turn_retained: false,
          detail,
        },
      },
    };
    safeWriteJson(join(root, '.agentxchain', 'state.json'), nextState);
  }

  emitRunEvent(root, 'operator_commit_reconcile_refused', {
    run_id: state?.run_id || session.current_run_id || null,
    phase: state?.phase || state?.current_phase || null,
    status: 'blocked',
    payload: {
      error_class: errorClass,
      message: result.error || null,
      previous_baseline: result.previous_baseline || null,
      current_head: result.current_head || null,
      offending_commit: result.offending_commit || null,
      offending_path: result.offending_path || null,
      safety_mode: 'auto_safe_only',
    },
  });

  session.status = 'paused';
  writeContinuousSession(root, session);
  log(detail);
  return {
    ok: true,
    status: 'blocked',
    action: 'operator_commit_reconcile_refused',
    run_id: session.current_run_id,
    recovery_action: 'agentxchain reconcile-state --accept-operator-head',
    blocked_category: 'operator_commit_reconcile_refused',
    error_class: errorClass,
  };
}

function reconcileContinuousStartupState(context, session, contOpts, log) {
  const { root, config } = context;
  const governedState = loadProjectState(root, config);
  const scopedRunId = session.current_run_id || contOpts.continueFrom || governedState?.run_id || null;

  let sessionChanged = false;
  if (scopedRunId && session.current_run_id !== scopedRunId) {
    session.current_run_id = scopedRunId;
    sessionChanged = true;
  }

  if (scopedRunId) {
    const startupIntents = archiveStaleIntentsForRun(root, scopedRunId, {
      protocolVersion: governedState?.protocol_version || config?.schema_version || '2.x',
    });
    if (startupIntents.archived_migration_intent_ids?.length > 0) {
      emitRunEvent(root, 'intents_migrated', {
        run_id: scopedRunId,
        phase: governedState?.phase || null,
        status: governedState?.status || 'active',
        payload: {
          archived_count: startupIntents.archived_migration_intent_ids.length,
          archived_intent_ids: startupIntents.archived_migration_intent_ids,
          reason: 'pre-BUG-34 intents with approved_run_id: null archived during continuous startup',
        },
      });
      const migrationNotice = formatLegacyIntentMigrationNotice(startupIntents.archived_migration_intent_ids);
      if (migrationNotice) log(migrationNotice);
    }
    if (startupIntents.phantom_superseded_intent_ids?.length > 0) {
      emitRunEvent(root, 'intents_superseded', {
        run_id: scopedRunId,
        phase: governedState?.phase || null,
        status: governedState?.status || 'active',
        payload: {
          superseded_count: startupIntents.phantom_superseded_intent_ids.length,
          superseded_intent_ids: startupIntents.phantom_superseded_intent_ids,
          reason: 'approved intents already satisfied by on-disk planning artifacts superseded during continuous startup',
        },
      });
      const phantomNotice = formatPhantomIntentSupersessionNotice(startupIntents.phantom_superseded_intent_ids);
      if (phantomNotice) log(phantomNotice);
    }
    if (session.startup_reconciled_run_id !== scopedRunId) {
      session.startup_reconciled_run_id = scopedRunId;
      sessionChanged = true;
    }
  }

  if (sessionChanged) {
    writeContinuousSession(root, session);
  }
}

// ---------------------------------------------------------------------------
// Vision-to-intake pipeline
// ---------------------------------------------------------------------------

/**
 * Derive the next vision candidate and record it through the intake pipeline.
 *
 * @param {string} root
 * @param {string} visionPath - Absolute path to VISION.md
 * @param {{ triageApproval?: string }} options
 * @returns {{ ok: boolean, intentId?: string, section?: string, goal?: string, error?: string, idle?: boolean }}
 */
export function seedFromVision(root, visionPath, options = {}) {
  const roadmapResult = deriveRoadmapCandidates(root);
  if (!roadmapResult.ok) {
    return { ok: false, error: roadmapResult.error };
  }

  if (roadmapResult.candidates.length > 0) {
    const candidate = roadmapResult.candidates[0];
    const eventResult = recordEvent(root, {
      source: 'vision_scan',
      category: 'roadmap_open_work_detected',
      signal: {
        description: `${candidate.section}: ${candidate.goal}`,
        roadmap_milestone: candidate.section,
        roadmap_path: candidate.roadmap_path,
        roadmap_line: candidate.line,
        derived: true,
      },
      evidence: [
        { type: 'file', value: `${candidate.roadmap_path}:${candidate.line}` },
        { type: 'text', value: `Unchecked roadmap work: ${candidate.section} — ${candidate.goal}` },
      ],
    });

    if (!eventResult.ok) {
      if (eventResult.deduplicated) {
        return { ok: true, idle: true };
      }
      return { ok: false, error: `intake record failed: ${eventResult.error}` };
    }

    if (eventResult.deduplicated) {
      return { ok: true, idle: true };
    }

    const intentId = eventResult.intent.intent_id;
    const triageResult = triageIntent(root, intentId, {
      priority: candidate.priority,
      template: 'generic',
      charter: `[roadmap] ${candidate.section}: ${candidate.goal}`,
      acceptance_contract: [
        `Roadmap milestone addressed: ${candidate.section}`,
        `Unchecked roadmap item completed: ${candidate.goal}`,
        `Evidence source: ${candidate.roadmap_path}:${candidate.line}`,
      ],
    });

    if (!triageResult.ok) {
      return { ok: false, error: `triage failed: ${triageResult.error}` };
    }

    const triageApproval = options.triageApproval || 'auto';
    if (triageApproval === 'auto') {
      const approveResult = approveIntent(root, intentId, {
        approver: 'continuous_loop',
        reason: 'roadmap-open-work auto-approval',
      });
      if (!approveResult.ok) {
        return { ok: false, error: `approve failed: ${approveResult.error}` };
      }
    }

    return {
      ok: true,
      idle: false,
      intentId,
      section: candidate.section,
      goal: candidate.goal,
      source: candidate.source,
      roadmap_path: candidate.roadmap_path,
      roadmap_line: candidate.line,
    };
  }

  // BUG-77: Once the roadmap has no unchecked work, check whether it is
  // exhausted while VISION still has unplanned sections before considering
  // broad per-goal vision candidates. Otherwise accumulated projects with old
  // generic vision candidates can bypass PM roadmap replenishment.
  const exhaustion = detectRoadmapExhaustedVisionOpen(root, visionPath);
  if (exhaustion.open) {
    const sectionNames = formatVisionSectionScope(exhaustion.unplanned_sections);
    const fullSectionNames = exhaustion.unplanned_sections.join(', ');
    const replenishmentEvent = recordEvent(root, {
      source: 'vision_scan',
      category: 'roadmap_exhausted_vision_open',
      signal: {
        description: `Roadmap exhausted (${exhaustion.total_milestones} milestones checked through ${exhaustion.latest_milestone}). VISION.md has unplanned scope: ${sectionNames}`,
        unplanned_sections: exhaustion.unplanned_sections,
        latest_milestone: exhaustion.latest_milestone,
        derived: true,
      },
      evidence: [
        { type: 'text', value: `All ${exhaustion.total_milestones} roadmap milestones checked. VISION sections not yet planned: ${fullSectionNames}` },
      ],
    });

    if (!replenishmentEvent.ok) {
      if (replenishmentEvent.deduplicated) {
        return { ok: true, idle: true };
      }
      return { ok: false, error: `intake record failed: ${replenishmentEvent.error}` };
    }

    if (replenishmentEvent.deduplicated) {
      return { ok: true, idle: true };
    }

    const replenishmentIntentId = replenishmentEvent.intent.intent_id;
    const replenishmentHints = getRoadmapReplenishmentTriageHints(root);
    const triageResult = triageIntent(root, replenishmentIntentId, {
      priority: 'p1',
      template: 'generic',
      ...(replenishmentHints.preferred_role ? { preferred_role: replenishmentHints.preferred_role } : {}),
      ...(replenishmentHints.phase_scope ? { phase_scope: replenishmentHints.phase_scope } : {}),
      charter: `[roadmap-replenishment] Derive next bounded roadmap increment from VISION.md. Candidate pool: ${sectionNames}. Current roadmap checked through ${exhaustion.latest_milestone}. Read .planning/VISION.md and .planning/ROADMAP.md to select one next testable milestone. Produce concrete unchecked M${exhaustion.total_milestones + 1} items. Do not re-verify previous completed milestones.`,
      acceptance_contract: [
        `New unchecked milestone items added to .planning/ROADMAP.md`,
        `Milestone cites at least one concrete VISION.md source section from the unplanned backlog`,
        `Milestone is bounded, testable, and does not duplicate existing checked milestones`,
      ],
    });

    if (!triageResult.ok) {
      return { ok: false, error: `triage failed: ${triageResult.error}` };
    }

    const triageApproval = options.triageApproval || 'auto';
    if (triageApproval === 'auto') {
      const approveResult = approveIntent(root, replenishmentIntentId, {
        approver: 'continuous_loop',
        reason: 'roadmap-replenishment auto-approval (BUG-77)',
      });
      if (!approveResult.ok) {
        return { ok: false, error: `approve failed: ${approveResult.error}` };
      }
    }

    return {
      ok: true,
      idle: false,
      intentId: replenishmentIntentId,
      section: 'Roadmap replenishment',
      goal: `Derive next increment from unplanned VISION scope: ${sectionNames}`,
      source: 'roadmap_replenishment',
    };
  }

  const result = deriveVisionCandidates(root, visionPath);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  if (result.candidates.length === 0) {
    return { ok: true, idle: true };
  }

  // Take the first unaddressed candidate
  const candidate = result.candidates[0];

  // Record event through intake
  const eventResult = recordEvent(root, {
    source: 'vision_scan',
    category: 'vision_derived',
    signal: {
      description: candidate.goal,
      vision_section: candidate.section,
      derived: true,
    },
    evidence: [
      { type: 'text', value: `Vision section: ${candidate.section} — Goal: ${candidate.goal}` },
    ],
  });

  if (!eventResult.ok) {
    // Deduplication is normal — means this goal already has an intent
    if (eventResult.deduplicated) {
      return { ok: true, idle: true };
    }
    return { ok: false, error: `intake record failed: ${eventResult.error}` };
  }

  if (eventResult.deduplicated) {
    return { ok: true, idle: true };
  }

  const intentId = eventResult.intent.intent_id;

  // Triage
  const triageResult = triageIntent(root, intentId, {
    priority: candidate.priority,
    template: 'generic',
    charter: `[vision] ${candidate.section}: ${candidate.goal}`,
    acceptance_contract: [`Vision goal addressed: ${candidate.goal}`],
  });

  if (!triageResult.ok) {
    return { ok: false, error: `triage failed: ${triageResult.error}` };
  }

  // Auto-approve if configured
  const triageApproval = options.triageApproval || 'auto';
  if (triageApproval === 'auto') {
    const approveResult = approveIntent(root, intentId, {
      approver: 'continuous_loop',
      reason: 'vision-derived auto-approval',
    });
    if (!approveResult.ok) {
      return { ok: false, error: `approve failed: ${approveResult.error}` };
    }
  }

  return {
    ok: true,
    idle: false,
    intentId,
    section: candidate.section,
    goal: candidate.goal,
    source: 'vision_scan',
  };
}

// ---------------------------------------------------------------------------
// BUG-60: Idle-expansion dispatch + ingestion for perpetual continuous mode
// ---------------------------------------------------------------------------

/**
 * Dispatch a PM idle-expansion turn via the intake pipeline.
 *
 * Called when on_idle === "perpetual" and idle_cycles >= maxIdleCycles.
 * Records a `vision_idle_expansion` intake event with deterministic signal,
 * triages and auto-approves the synthesized PM intent, then returns a
 * non-terminal step so the main loop re-enters on the next cycle.
 *
 * Returns null if the expansion cannot be dispatched (cap reached, source
 * manifest fails, etc.) — caller falls through to idle_exit.
 *
 * @returns {{ ok, status, action, ... } | null}
 */
async function dispatchIdleExpansion(context, session, contOpts, absVisionPath, log = console.log) {
  const { root } = context;
  const expansion = contOpts.idleExpansion;
  if (!expansion) return null;

  // Check expansion iteration cap
  const currentIteration = (session.expansion_iteration || 0) + 1;
  if (currentIteration > expansion.maxExpansions) {
    session.status = 'vision_expansion_exhausted';
    writeContinuousSession(root, session);
    log(`Idle-expansion cap reached (${expansion.maxExpansions} expansions). Stopping.`);
    emitRunEvent(root, 'idle_expansion_cap_reached', {
      run_id: session.current_run_id || null,
      phase: null,
      status: 'completed',
      payload: {
        session_id: session.session_id,
        expansion_iteration: currentIteration - 1,
        max_expansions: expansion.maxExpansions,
      },
    });
    return {
      ok: true,
      status: 'vision_expansion_exhausted',
      action: 'idle_expansion_cap_reached',
      stop_reason: 'vision_expansion_exhausted',
    };
  }

  // Build bounded source manifest
  const manifest = buildSourceManifest(root, expansion.sources);
  if (!manifest.ok) {
    log(`Idle-expansion source manifest failed: ${manifest.error}`);
    return null; // Fall through to idle_exit
  }

  // Build the PM charter for idle-expansion
  const sourceList = manifest.entries
    .filter(e => e.present)
    .map(e => `  - ${e.path} (${e.headings.length} headings, ${e.byte_count} bytes${e.warning ? `, warning: ${e.warning}` : ''})`)
    .join('\n');
  const visionHeadings = (session.vision_headings_snapshot || []).map(h => `  - ${h}`).join('\n');
  const idleExpansionPrompt = readIdleExpansionPrompt(root, context.config);
  const promptBlock = idleExpansionPrompt.content
    ? [
      ``,
      `PM idle-expansion prompt from ${idleExpansionPrompt.promptPath}:`,
      idleExpansionPrompt.content,
    ]
    : idleExpansionPrompt.warning
      ? [
        ``,
        `PM idle-expansion prompt warning: ${idleExpansionPrompt.warning}`,
      ]
      : [];

  const charter = [
    `[idle-expansion #${currentIteration}] Inspect VISION.md, ROADMAP.md, SYSTEM_SPEC.md, and current project state.`,
    `Derive the next concrete increment as a new intake intent with charter + acceptance_contract + priority.`,
    `If ALL vision goals are genuinely exhausted, declare vision_exhausted with per-heading classification.`,
    ``,
    `CONSTRAINTS:`,
    `- Do NOT modify .planning/VISION.md (human-owned, read-only).`,
    `- ROADMAP.md and SYSTEM_SPEC.md may be updated as supporting evidence.`,
    `- Every proposed intent MUST cite at least one VISION.md heading from the snapshot below.`,
    `- Output MUST be a structured idle_expansion_result (new_intake_intent or vision_exhausted).`,
    ``,
    `OUTPUT FORMAT — you MUST do one of these:`,
    `(a) Include "idle_expansion_result" as a top-level key in your turn-result.json, OR`,
    `(b) Save the result as a sibling file named idle-expansion-result.json next to your turn-result.json in the staging directory.`,
    ``,
    `The JSON object MUST have this shape:`,
    `  { "kind": "new_intake_intent", "expansion_iteration": ${currentIteration},`,
    `    "new_intake_intent": {`,
    `      "title": "...", "priority": "p1|p2|p3", "template": "generic",`,
    `      "charter": "...", "acceptance_contract": ["criterion 1", ...]`,
    `    },`,
    `    "vision_traceability": [`,
    `      { "vision_heading": "heading from snapshot", "goal": "what this advances", "kind": "advances" }`,
    `    ] }`,
    `OR:`,
    `  { "kind": "vision_exhausted", "expansion_iteration": ${currentIteration},`,
    `    "headings": [{"heading": "...", "status": "complete|deferred|out_of_scope", "reason": "..."}] }`,
    ``,
    `Do NOT just describe the result in text — you must produce the actual JSON object.`,
    ``,
    `VISION headings snapshot:`,
    visionHeadings || '  (none captured)',
    ``,
    `Source manifest:`,
    sourceList || '  (no sources available)',
    ...promptBlock,
  ].join('\n');

  // Use a placeholder accepted_turn_id for the signal — it will be the turn assigned by intake
  // We use session_id + iteration as a pre-dispatch key; the real signal with accepted_turn_id
  // is built after the PM turn completes and is accepted via ingestAcceptedIdleExpansion.
  const preDispatchSignal = buildVisionIdleExpansionSignal(
    session.session_id,
    currentIteration,
    `pre_dispatch_${session.session_id}_${currentIteration}`,
  );

  const idleExpansionContext = {
    expansion_iteration: currentIteration,
    vision_headings_snapshot: session.vision_headings_snapshot || [],
  };

  // Record through intake pipeline
  const eventResult = recordEvent(root, {
    source: 'vision_idle_expansion',
    category: 'idle_expansion',
    signal: preDispatchSignal,
    idle_expansion_context: idleExpansionContext,
    evidence: [
      { type: 'text', value: `Idle-expansion iteration ${currentIteration}/${expansion.maxExpansions} — PM deriving next increment from vision/roadmap/spec.` },
    ],
  });

  if (!eventResult.ok) {
    if (eventResult.deduplicated) {
      log(`Idle-expansion iteration ${currentIteration} already recorded (deduplicated). Skipping.`);
      return null;
    }
    log(`Idle-expansion intake record failed: ${eventResult.error}`);
    return null;
  }

  const intentId = eventResult.intent.intent_id;

  // Triage with idle-expansion charter
  const triageResult = triageIntent(root, intentId, {
    priority: 'p1',
    template: 'generic',
    charter,
    acceptance_contract: [
      'Produces a structured idle_expansion_result with kind "new_intake_intent" or "vision_exhausted".',
      'If new_intake_intent: contains charter, acceptance_contract (array), priority, and vision_traceability citing snapshot headings.',
      'If vision_exhausted: contains per-heading classification covering all snapshot headings.',
    ],
  });

  if (!triageResult.ok) {
    log(`Idle-expansion triage failed: ${triageResult.error}`);
    return null;
  }

  // Auto-approve (idle-expansion intents are always auto-approved in perpetual mode)
  const approveResult = approveIntent(root, intentId, {
    approver: 'continuous_loop_idle_expansion',
    reason: `idle-expansion iteration ${currentIteration}`,
  });

  if (!approveResult.ok) {
    log(`Idle-expansion approve failed: ${approveResult.error}`);
    return null;
  }

  // Update session state
  session.expansion_iteration = currentIteration;
  session.idle_cycles = 0; // Reset idle cycles after dispatching expansion
  writeContinuousSession(root, session);

  emitRunEvent(root, 'idle_expansion_dispatched', {
    run_id: session.current_run_id || null,
    phase: null,
    status: 'running',
    payload: {
      session_id: session.session_id,
      expansion_iteration: currentIteration,
      max_expansions: expansion.maxExpansions,
      intent_id: intentId,
      role: expansion.role,
      source_count: manifest.entries.length,
      sources_present: manifest.entries.filter(e => e.present).length,
    },
  });

  log(`Idle-expansion ${currentIteration}/${expansion.maxExpansions} dispatched — PM intent ${intentId} queued.`);
  return {
    ok: true,
    status: 'running',
    action: 'idle_expansion_dispatched',
    intent_id: intentId,
    expansion_iteration: currentIteration,
  };
}

/**
 * Ingest the accepted result of a PM idle-expansion turn.
 *
 * Called after a PM turn with `intake_context.source === 'vision_idle_expansion'`
 * has been accepted. Reads the `idle_expansion_result` from the accepted turn
 * result and either:
 *   (a) records a new intake intent from `new_intake_intent` → returns { ingested: true, kind: 'new_intake_intent', intentId }
 *   (b) sets session status to `vision_exhausted` → returns { ingested: true, kind: 'vision_exhausted' }
 *   (c) returns { ingested: false, error } on malformed output
 *
 * @param {object} context - { root, config }
 * @param {object} session - mutable session
 * @param {{ turnResult: object, historyEntry: object, state: object }} accepted
 * @returns {{ ingested: boolean, kind?: string, intentId?: string, error?: string }}
 */
export function ingestAcceptedIdleExpansion(context, session, accepted) {
  const { root } = context;
  const { turnResult } = accepted;
  const result = turnResult?.idle_expansion_result;

  if (!result || typeof result !== 'object') {
    emitRunEvent(root, 'idle_expansion_malformed', {
      run_id: session.current_run_id || null,
      phase: null,
      status: 'running',
      payload: {
        session_id: session.session_id,
        expansion_iteration: session.expansion_iteration,
        error: 'Missing or invalid idle_expansion_result in accepted turn result.',
      },
    });
    return { ingested: false, error: 'Missing or invalid idle_expansion_result in accepted turn result.' };
  }

  if (result.kind === 'new_intake_intent') {
    const intent = result.new_intake_intent;
    if (!intent || !intent.charter || !Array.isArray(intent.acceptance_contract) || intent.acceptance_contract.length === 0) {
      emitRunEvent(root, 'idle_expansion_malformed', {
        run_id: session.current_run_id || null,
        phase: null,
        status: 'running',
        payload: {
          session_id: session.session_id,
          expansion_iteration: session.expansion_iteration,
          error: 'new_intake_intent missing required fields (charter, acceptance_contract).',
        },
      });
      return { ingested: false, error: 'new_intake_intent missing required fields (charter, acceptance_contract).' };
    }

    // Record the PM-derived intent through the normal intake pipeline
    const eventResult = recordEvent(root, {
      source: 'vision_scan',
      category: 'pm_idle_expansion_derived',
      signal: {
        description: intent.charter,
        derived: true,
        expansion_iteration: session.expansion_iteration,
        vision_traceability: result.vision_traceability || null,
      },
      evidence: [
        { type: 'text', value: `PM idle-expansion #${session.expansion_iteration} derived: ${intent.charter}` },
      ],
    });

    if (!eventResult.ok) {
      if (eventResult.deduplicated) {
        return { ingested: true, kind: 'new_intake_intent', intentId: null, deduplicated: true };
      }
      return { ingested: false, error: `Intake record for PM-derived intent failed: ${eventResult.error}` };
    }

    const newIntentId = eventResult.intent.intent_id;

    // Triage with PM-derived charter and acceptance contract
    const triageResult = triageIntent(root, newIntentId, {
      priority: intent.priority || 'p2',
      template: intent.template || 'generic',
      charter: `[pm-derived] ${intent.charter}`,
      acceptance_contract: intent.acceptance_contract,
    });

    if (!triageResult.ok) {
      return { ingested: false, error: `Triage for PM-derived intent failed: ${triageResult.error}` };
    }

    // Auto-approve the PM-derived intent
    const approveResult = approveIntent(root, newIntentId, {
      approver: 'idle_expansion_ingestion',
      reason: `PM idle-expansion #${session.expansion_iteration} derived intent`,
    });

    if (!approveResult.ok) {
      return { ingested: false, error: `Approve for PM-derived intent failed: ${approveResult.error}` };
    }

    emitRunEvent(root, 'idle_expansion_ingested', {
      run_id: session.current_run_id || null,
      phase: null,
      status: 'running',
      payload: {
        session_id: session.session_id,
        expansion_iteration: session.expansion_iteration,
        kind: 'new_intake_intent',
        intent_id: newIntentId,
        charter: intent.charter,
        priority: intent.priority || 'p2',
      },
    });

    return { ingested: true, kind: 'new_intake_intent', intentId: newIntentId };
  }

  if (result.kind === 'vision_exhausted') {
    session.status = 'vision_exhausted';
    writeContinuousSession(root, session);

    emitRunEvent(root, 'idle_expansion_ingested', {
      run_id: session.current_run_id || null,
      phase: null,
      status: 'completed',
      payload: {
        session_id: session.session_id,
        expansion_iteration: session.expansion_iteration,
        kind: 'vision_exhausted',
        reason_excerpt: result.vision_exhausted?.classification?.[0]?.reason || null,
        classification: result.vision_exhausted?.classification || null,
      },
    });

    return { ingested: true, kind: 'vision_exhausted' };
  }

  // Unknown kind
  emitRunEvent(root, 'idle_expansion_malformed', {
    run_id: session.current_run_id || null,
    phase: null,
    status: 'running',
    payload: {
      session_id: session.session_id,
      expansion_iteration: session.expansion_iteration,
      error: `Unknown idle_expansion_result.kind: "${result.kind}". Expected "new_intake_intent" or "vision_exhausted".`,
    },
  });
  return { ingested: false, error: `Unknown idle_expansion_result.kind: "${result.kind}".` };
}

// ---------------------------------------------------------------------------
// Resolve continuous options from CLI flags + config
// ---------------------------------------------------------------------------

export function resolveContinuousOptions(opts, config) {
  const configCont = config?.run_loop?.continuous || {};
  const configGhostRetry = configCont.auto_retry_on_ghost || {};
  const explicitConfigGhostEnabled = Object.prototype.hasOwnProperty.call(configGhostRetry, 'enabled');
  const fullAuto = Boolean((opts.continuous ?? configCont.enabled ?? false) && isFullAutoApprovalPolicy(config));
  const fullAutoGhostDefault = fullAuto;
  const resolvedGhostEnabled = opts.autoRetryOnGhost
    ?? (explicitConfigGhostEnabled ? configGhostRetry.enabled : fullAutoGhostDefault);

  const validReconcileModes = new Set(['manual', 'auto_safe_only', 'disabled']);
  const configuredReconcile = typeof configCont.reconcile_operator_commits === 'string'
    && validReconcileModes.has(configCont.reconcile_operator_commits)
    ? configCont.reconcile_operator_commits
    : null;
  const cliReconcile = typeof opts.reconcileOperatorCommits === 'string'
    && validReconcileModes.has(opts.reconcileOperatorCommits)
    ? opts.reconcileOperatorCommits
    : null;
  const reconcileOperatorCommits = cliReconcile
    ?? configuredReconcile
    ?? (fullAuto ? 'auto_safe_only' : 'manual');

  // Resolve on_idle policy — CLI flag overrides config
  const validOnIdle = new Set(['exit', 'perpetual', 'human_review']);
  const configOnIdle = typeof configCont.on_idle === 'string' && validOnIdle.has(configCont.on_idle)
    ? configCont.on_idle : null;
  const cliOnIdle = typeof opts.onIdle === 'string' && validOnIdle.has(opts.onIdle)
    ? opts.onIdle : null;
  const onIdle = cliOnIdle ?? configOnIdle ?? 'exit';

  // Resolve idle_expansion block when perpetual mode is active
  const configIdleExpansion = configCont.idle_expansion || {};
  const idleExpansion = onIdle === 'perpetual' ? {
    sources: Array.isArray(configIdleExpansion.sources) && configIdleExpansion.sources.length > 0
      ? configIdleExpansion.sources
      : ['.planning/VISION.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
    maxExpansions: configIdleExpansion.max_expansions ?? 5,
    role: configIdleExpansion.role ?? 'pm',
    malformedRetryLimit: configIdleExpansion.malformed_retry_limit ?? 1,
    pmPromptPath: typeof configIdleExpansion.pm_prompt_path === 'string'
      && configIdleExpansion.pm_prompt_path.trim().length > 0
      ? configIdleExpansion.pm_prompt_path.trim()
      : '.agentxchain/prompts/pm-idle-expansion.md',
  } : null;

  return {
    enabled: opts.continuous ?? configCont.enabled ?? false,
    continueFrom: opts.continueFrom ?? null,
    visionPath: opts.vision ?? configCont.vision_path ?? '.planning/VISION.md',
    maxRuns: opts.maxRuns ?? configCont.max_runs ?? 100,
    pollSeconds: opts.pollSeconds ?? configCont.poll_seconds ?? 30,
    maxIdleCycles: opts.maxIdleCycles ?? configCont.max_idle_cycles ?? 3,
    triageApproval: opts.triageApproval ?? configCont.triage_approval ?? 'auto',
    cooldownSeconds: opts.cooldownSeconds ?? configCont.cooldown_seconds ?? 5,
    perSessionMaxUsd: opts.sessionBudget ?? configCont.per_session_max_usd ?? null,
    autoCheckpoint: opts.autoCheckpoint ?? configCont.auto_checkpoint ?? true,
    autoRetryOnGhost: {
      enabled: resolvedGhostEnabled ?? false,
      maxRetriesPerRun: opts.autoRetryOnGhostMaxRetries
        ?? configGhostRetry.max_retries_per_run
        ?? 3,
      cooldownSeconds: opts.autoRetryOnGhostCooldownSeconds
        ?? configGhostRetry.cooldown_seconds
        ?? 5,
    },
    reconcileOperatorCommits,
    onIdle,
    idleExpansion,
  };
}

export function isFullAutoApprovalPolicy(config) {
  const policy = config?.approval_policy;
  if (!policy || typeof policy !== 'object') return false;
  return policy.phase_transitions?.default === 'auto_approve'
    && policy.run_completion?.action === 'auto_approve';
}

// ---------------------------------------------------------------------------
// Single-step continuous advancement primitive
// ---------------------------------------------------------------------------

/**
 * Advance a continuous session by exactly one step.
 *
 * This is the shared primitive used by both `run --continuous` (CLI-owned loop)
 * and `schedule daemon` (daemon-owned poll). Neither caller embeds a nested
 * poll/sleep loop — the caller owns cadence, this function owns one step.
 *
 * @param {object} context - { root, config }
 * @param {object} session - mutable session object (read/written by caller)
 * @param {object} contOpts - resolved continuous options (visionPath, maxRuns, maxIdleCycles, triageApproval)
 * @param {Function} executeGovernedRun - the run executor function
 * @param {Function} [log] - logging function
 * @returns {Promise<{ ok: boolean, status: string, action: string, run_id?: string, intent_id?: string, stop_reason?: string }>}
 */
export async function advanceContinuousRunOnce(context, session, contOpts, executeGovernedRun, log = console.log) {
  const { root } = context;
  const absVisionPath = resolveVisionPath(root, contOpts.visionPath);

  // BUG-60 Slice 3: detect VISION.md content drift since session snapshot
  if (session.vision_sha_at_snapshot && existsSync(absVisionPath)) {
    try {
      const currentContent = readFileSync(absVisionPath, 'utf8');
      const currentSha = computeVisionContentSha(currentContent);
      const warnedShas = session._vision_stale_warned_shas || [];
      if (currentSha !== session.vision_sha_at_snapshot && !warnedShas.includes(currentSha)) {
        emitRunEvent(root, 'vision_snapshot_stale', {
          run_id: session.current_run_id || null,
          phase: null,
          status: session.status || 'running',
          payload: {
            session_id: session.session_id,
            snapshot_sha: session.vision_sha_at_snapshot,
            current_sha: currentSha,
            vision_path: contOpts.visionPath,
          },
        });
        session._vision_stale_warned_shas = [...warnedShas, currentSha];
        writeContinuousSession(root, session);
        log(`Warning: VISION.md has changed since session started (snapshot: ${session.vision_sha_at_snapshot.slice(0, 8)}, current: ${currentSha.slice(0, 8)}). Active session keeps its heading snapshot.`);
      }
    } catch {
      // VISION.md read failed — will be caught by the vision_missing guard below
    }
  }

  // Terminal checks — order matters: max_runs, then budget, then idle policy.
  // Budget MUST fire before idle-expansion dispatch (BUG-60 Plan §5).
  if (session.runs_completed >= contOpts.maxRuns) {
    session.status = 'completed';
    writeContinuousSession(root, session);
    return { ok: true, status: 'completed', action: 'max_runs_reached', stop_reason: 'max_runs' };
  }

  // Session budget check (cumulative spend across all runs) — before idle policy
  const sessionBudget = session.per_session_max_usd ?? contOpts.perSessionMaxUsd ?? null;
  if (sessionBudget != null && (session.cumulative_spent_usd || 0) >= sessionBudget) {
    session.status = 'session_budget';
    session.budget_exhausted = true;
    writeContinuousSession(root, session);
    log(`Session budget exhausted: $${(session.cumulative_spent_usd || 0).toFixed(2)} spent of $${sessionBudget.toFixed(2)} limit.`);
    return { ok: true, status: 'session_budget', action: 'session_budget_exhausted', stop_reason: 'session_budget' };
  }

  reconcileContinuousStartupState(context, session, contOpts, log);

  const reconcileBlock = maybeAutoReconcileOperatorCommits(context, session, contOpts, log);
  if (reconcileBlock) return reconcileBlock;

  const startupGovernedState = loadProjectState(root, context.config);
  if (startupGovernedState?.status === 'blocked') {
    const reclassifiedState = maybeReclassifyRetainedClaudeAuthEscalation(context, session, startupGovernedState, log);
    const effectiveBlockedState = reclassifiedState || startupGovernedState;
    const retried = await maybeAutoRetryContinuousBlocker(context, session, contOpts, effectiveBlockedState, log);
    if (retried) return retried;
    session.status = 'paused';
    writeContinuousSession(root, session);
    return {
      ok: true,
      status: 'blocked',
      action: 'still_blocked',
      run_id: session.current_run_id || effectiveBlockedState.run_id || null,
      recovery_action: getBlockedRecoveryAction(effectiveBlockedState),
      blocked_category: getBlockedCategory(effectiveBlockedState),
    };
  }

  // Idle-cycle check: on_idle policy determines behavior. This MUST run after
  // startup blocked/reconcile checks so perpetual mode cannot enqueue new
  // idle-expansion work into a run that is already ineligible to start.
  if (session.idle_cycles >= contOpts.maxIdleCycles) {
    if (contOpts.onIdle === 'perpetual' && contOpts.idleExpansion) {
      // BUG-60: perpetual mode — dispatch PM idle-expansion instead of exiting
      const expansionResult = await dispatchIdleExpansion(context, session, contOpts, absVisionPath, log);
      if (expansionResult) return expansionResult;
      // If dispatchIdleExpansion returned null, fall through to idle_exit
    }
    if (contOpts.onIdle === 'human_review') {
      session.status = 'paused';
      writeContinuousSession(root, session);
      emitRunEvent(root, 'idle_human_review_required', {
        run_id: session.current_run_id || null,
        phase: null,
        status: 'blocked',
        payload: {
          session_id: session.session_id,
          idle_cycles: session.idle_cycles,
          max_idle_cycles: contOpts.maxIdleCycles,
          vision_path: contOpts.visionPath,
        },
      });
      log(`Idle threshold reached (${session.idle_cycles}/${contOpts.maxIdleCycles}) — pausing for human review.`);
      return {
        ok: true,
        status: 'blocked',
        action: 'idle_human_review_required',
        stop_reason: 'human_review',
        run_id: session.current_run_id || null,
        recovery_action: 'Review .agentxchain/continuous-session.json and either inject/approve new work or rerun with --on-idle exit/perpetual.',
        blocked_category: 'idle_human_review',
      };
    }
    session.status = 'completed';
    writeContinuousSession(root, session);
    return { ok: true, status: 'idle_exit', action: 'max_idle_reached', stop_reason: 'idle_exit' };
  }

  // Paused-session guard: if session is paused (blocked run awaiting unblock),
  // check governed state before attempting to advance. Without this guard, the
  // loop would try to startIntent() on a blocked project, hit the blocked-state
  // rejection, and permanently fail the session instead of staying paused.
  if (session.status === 'paused') {
    const governedState = loadProjectState(root, context.config);
    if (governedState?.status === 'blocked') {
      const retried = await maybeAutoRetryContinuousBlocker(context, session, contOpts, governedState, log);
      if (retried) return retried;
      // Still blocked — stay paused, do not attempt new work
      writeContinuousSession(root, session);
      return {
        ok: true,
        status: 'blocked',
        action: 'still_blocked',
        run_id: session.current_run_id,
        recovery_action: getBlockedRecoveryAction(governedState),
        blocked_category: getBlockedCategory(governedState),
      };
    }
    if (isPausedContinuousSessionRecoverableActiveRun(session, governedState, context.config)) {
      session.status = 'running';
      writeContinuousSession(root, session);
      emitRunEvent(root, 'continuous_paused_active_run_recovered', {
        run_id: governedState.run_id || session.current_run_id || null,
        phase: governedState.phase || null,
        status: governedState.status || 'active',
        payload: {
          session_id: session.session_id,
          reason: 'advance_once_paused_active_run',
          next_recommended_role: governedState.next_recommended_role || null,
        },
      });
      log(`Paused continuous session has active unblocked run ${governedState.run_id || session.current_run_id || '(unknown)'}; resuming next role dispatch.`);
    } else if (isPausedActiveRunWaitingOnGovernance(session, governedState)) {
      writeContinuousSession(root, session);
      return {
        ok: true,
        status: 'blocked',
        action: 'paused_active_run_waiting',
        run_id: session.current_run_id || governedState.run_id || null,
        recovery_action: 'Review pending approvals, active turns, or role-resolution errors before resuming this paused continuous session.',
        blocked_category: 'paused_active_run_waiting',
      };
    }
    // Unblocked — resume by continuing the existing governed run directly.
    // Skip the intake pipeline: the run is already in progress, and startIntent
    // would reject because the governed state is active.
    session.status = 'running';
    log('Blocked run resolved — resuming continuous session.');
    writeContinuousSession(root, session);

    let execution;
    try {
      execution = await executeGovernedRun(context, {
        autoApprove: true,
        autoCheckpoint: contOpts.autoCheckpoint,
        report: true,
        log,
      });
    } catch (err) {
      session.status = 'failed';
      writeContinuousSession(root, session);
      return { ok: false, status: 'failed', action: 'run_failed', stop_reason: err.message, run_id: session.current_run_id };
    }

    session.cumulative_spent_usd = (session.cumulative_spent_usd || 0) + getExecutionRunSpentUsd(execution);
    const resumeStopReason = execution.result?.stop_reason;

    if (isBlockedContinuousExecution(execution)) {
      const checkpointed = maybeAutoCheckpointBlockedExecution(context, session, contOpts, execution, log);
      if (checkpointed) return checkpointed;
      const blockedState = execution?.result?.state || loadProjectState(root, context.config);
      const retried = await maybeAutoRetryContinuousBlocker(context, session, contOpts, blockedState, log);
      if (retried) return retried;
      const blockedRecoveryAction = getBlockedRecoveryAction(blockedState);
      session.status = 'paused';
      log(blockedRecoveryAction
        ? `Resumed run blocked again — continuous loop re-paused. Recovery: ${blockedRecoveryAction}`
        : 'Resumed run blocked again — continuous loop re-paused.');
      writeContinuousSession(root, session);
      return {
        ok: true,
        status: 'blocked',
        action: 'run_blocked',
        run_id: session.current_run_id,
        recovery_action: blockedRecoveryAction,
        blocked_category: getBlockedCategory(blockedState),
      };
    }

    if (execution.exitCode !== 0 || !execution.result) {
      session.status = 'failed';
      writeContinuousSession(root, session);
      return { ok: false, status: 'failed', action: 'run_failed', stop_reason: resumeStopReason || `exit_code_${execution.exitCode}`, run_id: session.current_run_id };
    }

    const idleExpansionStep = ingestAcceptedIdleExpansionsFromExecution(context, session, execution, log);
    if (idleExpansionStep) {
      writeContinuousSession(root, session);
      return idleExpansionStep;
    }

    session.runs_completed += 1;
    session.current_run_id = execution.result?.state?.run_id || session.current_run_id;
    log(`Resumed run completed (${session.runs_completed}/${contOpts.maxRuns}): ${resumeStopReason || 'completed'}`);
    writeContinuousSession(root, session);
    return { ok: true, status: 'running', action: 'resumed_after_unblock', run_id: session.current_run_id };
  }

  const activeGovernedState = loadProjectState(root, context.config);
  const queuedIntent = session.current_run_id
    ? findNextDispatchableIntent(root, { run_id: session.current_run_id })
    : { ok: false };
  if (
    session.current_run_id
    && activeGovernedState?.status === 'active'
    && activeGovernedState.run_id === session.current_run_id
    && !contOpts.continueFrom
    && !queuedIntent.ok
  ) {
    log('Continuing active governed run.');
    let execution;
    try {
      execution = await executeGovernedRun(context, {
        autoApprove: true,
        autoCheckpoint: contOpts.autoCheckpoint,
        report: true,
        log,
      });
    } catch (err) {
      session.status = 'failed';
      writeContinuousSession(root, session);
      return { ok: false, status: 'failed', action: 'run_failed', stop_reason: err.message, run_id: session.current_run_id };
    }

    session.cumulative_spent_usd = (session.cumulative_spent_usd || 0) + getExecutionRunSpentUsd(execution);
    const resumeStopReason = execution.result?.stop_reason;

    if (isBlockedContinuousExecution(execution)) {
      const checkpointed = maybeAutoCheckpointBlockedExecution(context, session, contOpts, execution, log);
      if (checkpointed) return checkpointed;
      const blockedState = execution?.result?.state || loadProjectState(root, context.config);
      const retried = await maybeAutoRetryContinuousBlocker(context, session, contOpts, blockedState, log);
      if (retried) return retried;
      const blockedRecoveryAction = getBlockedRecoveryAction(blockedState);
      session.status = 'paused';
      log(blockedRecoveryAction
        ? `Active run blocked — continuous loop paused. Recovery: ${blockedRecoveryAction}`
        : 'Active run blocked — continuous loop paused.');
      writeContinuousSession(root, session);
      return {
        ok: true,
        status: 'blocked',
        action: 'run_blocked',
        run_id: session.current_run_id,
        recovery_action: blockedRecoveryAction,
        blocked_category: getBlockedCategory(blockedState),
      };
    }

    if (execution.exitCode !== 0 || !execution.result) {
      session.status = 'failed';
      writeContinuousSession(root, session);
      return { ok: false, status: 'failed', action: 'run_failed', stop_reason: resumeStopReason || `exit_code_${execution.exitCode}`, run_id: session.current_run_id };
    }

    const idleExpansionStep = ingestAcceptedIdleExpansionsFromExecution(context, session, execution, log);
    if (idleExpansionStep) {
      writeContinuousSession(root, session);
      return idleExpansionStep;
    }

    session.runs_completed += 1;
    session.current_run_id = execution.result?.state?.run_id || session.current_run_id;
    log(`Active run completed (${session.runs_completed}/${contOpts.maxRuns}): ${resumeStopReason || 'completed'}`);
    writeContinuousSession(root, session);
    return { ok: true, status: 'running', action: 'continued_active_run', run_id: session.current_run_id };
  }

  // Validate vision file
  if (!existsSync(absVisionPath)) {
    session.status = 'failed';
    writeContinuousSession(root, session);
    return { ok: false, status: 'failed', action: 'vision_missing', stop_reason: `VISION.md not found at ${absVisionPath}` };
  }

  // Step 1: Check intake queue for pending work (BUG-34: scope to current run)
  const queued = queuedIntent.ok
    ? queuedIntent
    : findNextDispatchableIntent(root, { run_id: session.current_run_id });
  let targetIntentId = null;
  let visionObjective = null;
  let seededSource = null;

  if (queued.ok) {
    targetIntentId = queued.intentId;
    session.idle_cycles = 0;
    log(`Found queued intent: ${queued.intentId} (${queued.status})`);
  } else {
    // Step 2: Derive from vision
    const seeded = seedFromVision(root, absVisionPath, {
      triageApproval: contOpts.triageApproval,
    });

    if (!seeded.ok) {
      log(`Vision scan error: ${seeded.error}`);
      session.status = 'failed';
      writeContinuousSession(root, session);
      return { ok: false, status: 'failed', action: 'vision_scan_error', stop_reason: seeded.error };
    }

    if (seeded.idle) {
      session.idle_cycles += 1;
      log(`Idle cycle ${session.idle_cycles}/${contOpts.maxIdleCycles} — no derivable work from vision.`);
      writeContinuousSession(root, session);
      return { ok: true, status: 'running', action: 'no_work_found' };
    }

    // If triage_approval is "human", the intent is in "triaged" state — don't auto-start
    if (contOpts.triageApproval === 'human') {
      log(`Vision-derived intent ${seeded.intentId} left in triaged state (triage_approval: human).`);
      session.idle_cycles += 1;
      writeContinuousSession(root, session);
      return { ok: true, status: 'running', action: 'waited_for_human', intent_id: seeded.intentId };
    }

    targetIntentId = seeded.intentId;
    visionObjective = `${seeded.section}: ${seeded.goal}`;
    seededSource = seeded.source || 'vision_scan';
    session.idle_cycles = 0;
    if (seeded.source === 'roadmap_open_work') {
      log(`Roadmap-derived: ${visionObjective}`);
    } else if (seeded.source === 'roadmap_replenishment') {
      log(`Roadmap-replenishment (roadmap exhausted, vision open): ${visionObjective}`);
    } else {
      log(`Vision-derived: ${visionObjective}`);
    }
  }

  // Prepare intent through intake lifecycle
  const provenance = buildContinuousProvenance(targetIntentId, {
    trigger: visionObjective
      ? (seededSource === 'roadmap_open_work' ? 'roadmap_open_work'
        : seededSource === 'roadmap_replenishment' ? 'roadmap_replenishment'
        : 'vision_scan')
      : 'intake',
    triggerReason: visionObjective || readIntent(root, targetIntentId)?.charter || null,
  });
  const preparedIntent = prepareIntentForDispatch(root, targetIntentId, {
    allowTerminalRestart: true,
    provenance,
  });
  if (!preparedIntent.ok) {
    log(`Continuous start error: ${preparedIntent.error}`);
    session.status = 'failed';
    writeContinuousSession(root, session);
    return { ok: false, status: 'failed', action: 'prepare_failed', stop_reason: preparedIntent.error, intent_id: targetIntentId };
  }

  // BUG-53: Auto-chain audit trail. When this advance step seeds a NEXT run
  // (i.e., at least one prior run already completed in this session), emit a
  // `session_continuation` event so operators have a visible record that the
  // loop auto-derived the next vision objective without intervention. Event
  // is emitted BEFORE we overwrite session.current_run_id so previous_run_id
  // reflects the just-completed run and next_run_id reflects the newly
  // prepared one. See HUMAN-ROADMAP BUG-53 fix #4.
  const previousRunId = session.current_run_id;
  const nextObjective = visionObjective || preparedIntent.intent?.charter || null;
  if ((session.runs_completed || 0) >= 1 && previousRunId && previousRunId !== preparedIntent.run_id) {
    emitRunEvent(root, 'session_continuation', {
      run_id: preparedIntent.run_id,
      phase: null,
      status: 'active',
      payload: {
        session_id: session.session_id,
        previous_run_id: previousRunId,
        next_run_id: preparedIntent.run_id,
        next_objective: nextObjective,
        next_intent_id: targetIntentId,
        runs_completed: session.runs_completed || 0,
        trigger: visionObjective
          ? (seededSource === 'roadmap_open_work' ? 'roadmap_open_work' : 'vision_scan')
          : 'intake',
      },
    });
  }

  // Execute the governed run
  session.current_run_id = preparedIntent.run_id;
  session.current_vision_objective = nextObjective;
  session.status = 'running';
  writeContinuousSession(root, session);

  let execution;
  try {
    execution = await executeGovernedRun(context, {
      autoApprove: true,
      autoCheckpoint: contOpts.autoCheckpoint,
      report: true,
      log,
    });
  } catch (err) {
    session.status = 'failed';
    writeContinuousSession(root, session);
    log(`Governed run threw during continuous execution: ${err.message}`);
    return {
      ok: false,
      status: 'failed',
      action: 'run_failed',
      stop_reason: err.message,
      run_id: preparedIntent.run_id || null,
      intent_id: targetIntentId,
    };
  }

  session.current_run_id = execution.result?.state?.run_id || preparedIntent.run_id || null;
  session.cumulative_spent_usd = (session.cumulative_spent_usd || 0) + getExecutionRunSpentUsd(execution);

  const stopReason = execution.result?.stop_reason;

  if (stopReason === 'priority_preempted') {
    log('Priority preemption detected — consuming injected work next cycle.');
    writeContinuousSession(root, session);
    return {
      ok: true,
      status: 'running',
      action: 'consumed_injected_priority',
      run_id: session.current_run_id,
      intent_id: targetIntentId,
    };
  }

  if (isBlockedContinuousExecution(execution)) {
    const checkpointed = maybeAutoCheckpointBlockedExecution(context, session, contOpts, execution, log);
    if (checkpointed) return checkpointed;
    const blockedState = execution?.result?.state || loadProjectState(root, context.config);
    const retried = await maybeAutoRetryContinuousBlocker(context, session, contOpts, blockedState, log);
    if (retried) return retried;
    const blockedRecoveryAction = getBlockedRecoveryAction(blockedState);
    const resolved = resolveIntent(root, targetIntentId);
    if (!resolved.ok) {
      log(`Continuous resolve error: ${resolved.error}`);
      session.status = 'failed';
      writeContinuousSession(root, session);
      return { ok: false, status: 'failed', action: 'resolve_failed', stop_reason: resolved.error, intent_id: targetIntentId };
    }
    session.status = 'paused';
    log(blockedRecoveryAction
      ? `Run blocked — continuous loop paused. Recovery: ${blockedRecoveryAction}`
      : 'Run blocked — continuous loop paused. Use `agentxchain unblock <id>` to resume.');
    writeContinuousSession(root, session);
    return {
      ok: true,
      status: 'blocked',
      action: 'run_blocked',
      run_id: session.current_run_id,
      intent_id: targetIntentId,
      recovery_action: blockedRecoveryAction,
      blocked_category: getBlockedCategory(blockedState),
    };
  }

  if (stopReason === 'caller_stopped') {
    session.status = 'stopped';
    writeContinuousSession(root, session);
    return {
      ok: true,
      status: 'stopped',
      action: 'operator_stopped',
      run_id: session.current_run_id,
      intent_id: targetIntentId,
    };
  }

  if (execution.exitCode !== 0 || !execution.result) {
    session.status = 'failed';
    writeContinuousSession(root, session);
    log(`Governed run failed during continuous execution: ${stopReason || `exit_code_${execution.exitCode}`}.`);
    return {
      ok: false,
      status: 'failed',
      action: 'run_failed',
      stop_reason: stopReason || `exit_code_${execution.exitCode}`,
      run_id: session.current_run_id,
      intent_id: targetIntentId,
    };
  }

  // Resolve the consumed intent
  const resolved = resolveIntent(root, targetIntentId);
  if (!resolved.ok) {
    log(`Continuous resolve error: ${resolved.error}`);
    session.status = 'failed';
    writeContinuousSession(root, session);
    return { ok: false, status: 'failed', action: 'resolve_failed', stop_reason: resolved.error, intent_id: targetIntentId };
  }

  const idleExpansionStep = ingestAcceptedIdleExpansionsFromExecution(context, session, execution, log);
  if (idleExpansionStep) {
    writeContinuousSession(root, session);
    return {
      ...idleExpansionStep,
      intent_id: idleExpansionStep.intent_id || targetIntentId,
    };
  }

  session.runs_completed += 1;
  log(`Run ${session.runs_completed}/${contOpts.maxRuns} completed: ${stopReason || 'unknown'}`);

  writeContinuousSession(root, session);
  return {
    ok: true,
    status: 'running',
    action: visionObjective ? 'seeded_from_vision' : 'started_run',
    run_id: session.current_run_id,
    intent_id: targetIntentId,
  };
}

// ---------------------------------------------------------------------------
// Main continuous loop (CLI-owned, built on advanceContinuousRunOnce)
// ---------------------------------------------------------------------------

/**
 * Execute the continuous vision-driven run loop.
 *
 * @param {object} context - { root, config }
 * @param {object} contOpts - resolved continuous options
 * @param {Function} executeGovernedRun - the run executor function
 * @param {Function} [log] - logging function
 * @returns {Promise<{ exitCode: number, session: object }>}
 */
export async function executeContinuousRun(context, contOpts, executeGovernedRun, log = console.log) {
  const { root } = context;
  const absVisionPath = resolveVisionPath(root, contOpts.visionPath);

  // Validate vision file exists
  if (!existsSync(absVisionPath)) {
    log(`Error: VISION.md not found at ${absVisionPath}`);
    log(`Create a .planning/VISION.md for your project to enable vision-driven operation.`);
    return { exitCode: 1, session: null };
  }

  const startupState = loadProjectState(root, context.config);
  const initialRunId = contOpts.continueFrom || startupState?.run_id || null;

  // BUG-60 Slice 3: capture vision heading snapshot + content hash at session start
  let visionHeadingsSnapshot = null;
  let visionShaAtSnapshot = null;
  try {
    const visionContent = readFileSync(absVisionPath, 'utf8');
    visionHeadingsSnapshot = captureVisionHeadingsSnapshot(visionContent);
    visionShaAtSnapshot = computeVisionContentSha(visionContent);
  } catch {
    // VISION.md unreadable — will fail at first advanceContinuousRunOnce anyway
  }

  const existingSession = readContinuousSession(root);
  const snapshotOpts = { visionHeadingsSnapshot, visionShaAtSnapshot };
  const session = canResumeExistingContinuousSession(existingSession, contOpts)
    ? resumeExistingContinuousSession(existingSession, contOpts, initialRunId, snapshotOpts)
    : createSession(
      contOpts.visionPath,
      contOpts.maxRuns,
      contOpts.maxIdleCycles,
      contOpts.perSessionMaxUsd,
      initialRunId,
      snapshotOpts,
    );
  writeContinuousSession(root, session);
  if (existingSession && session.session_id === existingSession.session_id) {
    emitRunEvent(root, 'continuous_session_resumed', {
      run_id: session.current_run_id || null,
      phase: startupState?.phase || null,
      status: session.status,
      payload: {
        session_id: session.session_id,
        prior_status: existingSession.status || null,
      },
    });
    log(`Resuming existing continuous session ${session.session_id}.`);
  }

  // SIGINT handler
  let stopping = false;
  const sigHandler = () => {
    stopping = true;
    log('\nStopping continuous loop (finishing current work)...');
  };
  process.on('SIGINT', sigHandler);

  try {
    while (!stopping) {
      const step = await advanceContinuousRunOnce(context, session, contOpts, executeGovernedRun, log);

      // Terminal states
      if (step.status === 'completed' || step.status === 'idle_exit' || step.status === 'failed' || step.status === 'blocked' || step.status === 'stopped' || step.status === 'vision_exhausted' || step.status === 'vision_expansion_exhausted' || step.status === 'session_budget') {
        const terminalMessage = describeContinuousTerminalStep(step, contOpts);
        if (terminalMessage) {
          log(terminalMessage);
        }
        return { exitCode: step.ok ? 0 : 1, session };
      }

      if (recoverPausedActiveContinuousSession(context, session, log, `post_step_${step.action || step.status || 'unknown'}`)) {
        continue;
      }

      // Non-terminal: sleep before next step
      if (!stopping) {
        const sleepMs = step.action === 'no_work_found' || step.action === 'waited_for_human'
          ? contOpts.pollSeconds * 1000
          : (contOpts.cooldownSeconds ?? 5) * 1000;
        if (sleepMs > 0) {
          await new Promise(r => setTimeout(r, sleepMs));
        }
      }
    }

    if (stopping) {
      session.status = 'stopped';
      log('Continuous loop stopped by operator.');
    }

    writeContinuousSession(root, session);
    return { exitCode: 0, session };

  } finally {
    process.removeListener('SIGINT', sigHandler);
  }
}
