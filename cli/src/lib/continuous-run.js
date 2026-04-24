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
import { resolveVisionPath, deriveVisionCandidates } from './vision-reader.js';
import {
  recordEvent,
  triageIntent,
  approveIntent,
  findNextDispatchableIntent,
  prepareIntentForDispatch,
  consumeNextApprovedIntent,
  resolveIntent,
} from './intake.js';
import { loadProjectState } from './config.js';
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
import { getDispatchLogPath } from './turn-paths.js';
import { reconcileOperatorHead } from './operator-commit-reconcile.js';
import { getContinuityStatus } from './continuity-status.js';
import {
  archiveStaleIntentsForRun,
  formatLegacyIntentMigrationNotice,
  formatPhantomIntentSupersessionNotice,
} from './intent-startup-migration.js';

const CONTINUOUS_SESSION_PATH = '.agentxchain/continuous-session.json';

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

function createSession(visionPath, maxRuns, maxIdleCycles, perSessionMaxUsd, currentRunId = null) {
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

function getBlockedRecoveryAction(state) {
  return state?.blocked_reason?.recovery?.recovery_action || null;
}

function getBlockedCategory(state) {
  return state?.blocked_reason?.category || null;
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
  };
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
  const validOnIdle = new Set(['exit', 'perpetual']);
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

  // Terminal checks
  if (session.runs_completed >= contOpts.maxRuns) {
    session.status = 'completed';
    writeContinuousSession(root, session);
    return { ok: true, status: 'completed', action: 'max_runs_reached', stop_reason: 'max_runs' };
  }

  if (session.idle_cycles >= contOpts.maxIdleCycles) {
    session.status = 'completed';
    writeContinuousSession(root, session);
    return { ok: true, status: 'idle_exit', action: 'max_idle_reached', stop_reason: 'idle_exit' };
  }

  // Session budget check (cumulative spend across all runs)
  const sessionBudget = session.per_session_max_usd ?? contOpts.perSessionMaxUsd ?? null;
  if (sessionBudget != null && (session.cumulative_spent_usd || 0) >= sessionBudget) {
    session.status = 'completed';
    session.budget_exhausted = true;
    writeContinuousSession(root, session);
    log(`Session budget exhausted: $${(session.cumulative_spent_usd || 0).toFixed(2)} spent of $${sessionBudget.toFixed(2)} limit.`);
    return { ok: true, status: 'completed', action: 'session_budget_exhausted', stop_reason: 'session_budget' };
  }

  reconcileContinuousStartupState(context, session, contOpts, log);

  const reconcileBlock = maybeAutoReconcileOperatorCommits(context, session, contOpts, log);
  if (reconcileBlock) return reconcileBlock;

  // Paused-session guard: if session is paused (blocked run awaiting unblock),
  // check governed state before attempting to advance. Without this guard, the
  // loop would try to startIntent() on a blocked project, hit the blocked-state
  // rejection, and permanently fail the session instead of staying paused.
  if (session.status === 'paused') {
    const governedState = loadProjectState(root, context.config);
    if (governedState?.status === 'blocked') {
      const retried = await maybeAutoRetryGhostBlocker(context, session, contOpts, governedState, log);
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
      const blockedState = execution?.result?.state || loadProjectState(root, context.config);
      const retried = await maybeAutoRetryGhostBlocker(context, session, contOpts, blockedState, log);
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
      const blockedState = execution?.result?.state || loadProjectState(root, context.config);
      const retried = await maybeAutoRetryGhostBlocker(context, session, contOpts, blockedState, log);
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
    session.idle_cycles = 0;
    log(`Vision-derived: ${visionObjective}`);
  }

  // Prepare intent through intake lifecycle
  const provenance = buildContinuousProvenance(targetIntentId, {
    trigger: visionObjective ? 'vision_scan' : 'intake',
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
        trigger: visionObjective ? 'vision_scan' : 'intake',
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
    const blockedState = execution?.result?.state || loadProjectState(root, context.config);
    const retried = await maybeAutoRetryGhostBlocker(context, session, contOpts, blockedState, log);
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

  session.runs_completed += 1;
  log(`Run ${session.runs_completed}/${contOpts.maxRuns} completed: ${stopReason || 'unknown'}`);

  // Resolve the consumed intent
  const resolved = resolveIntent(root, targetIntentId);
  if (!resolved.ok) {
    log(`Continuous resolve error: ${resolved.error}`);
    session.status = 'failed';
    writeContinuousSession(root, session);
    return { ok: false, status: 'failed', action: 'resolve_failed', stop_reason: resolved.error, intent_id: targetIntentId };
  }

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
  const session = createSession(
    contOpts.visionPath,
    contOpts.maxRuns,
    contOpts.maxIdleCycles,
    contOpts.perSessionMaxUsd,
    initialRunId,
  );
  writeContinuousSession(root, session);

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
      if (step.status === 'completed' || step.status === 'idle_exit' || step.status === 'failed' || step.status === 'blocked' || step.status === 'stopped') {
        const terminalMessage = describeContinuousTerminalStep(step, contOpts);
        if (terminalMessage) {
          log(terminalMessage);
        }
        return { exitCode: step.ok ? 0 : 1, session };
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
