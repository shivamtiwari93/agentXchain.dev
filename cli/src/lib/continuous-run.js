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
  };
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

  // Paused-session guard: if session is paused (blocked run awaiting unblock),
  // check governed state before attempting to advance. Without this guard, the
  // loop would try to startIntent() on a blocked project, hit the blocked-state
  // rejection, and permanently fail the session instead of staying paused.
  if (session.status === 'paused') {
    const governedState = loadProjectState(root, context.config);
    if (governedState?.status === 'blocked') {
      // Still blocked — stay paused, do not attempt new work
      writeContinuousSession(root, session);
      return {
        ok: true,
        status: 'blocked',
        action: 'still_blocked',
        run_id: session.current_run_id,
        recovery_action: getBlockedRecoveryAction(governedState),
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
      const blockedRecoveryAction = getBlockedRecoveryAction(execution?.result?.state || loadProjectState(root, context.config));
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

  // Validate vision file
  if (!existsSync(absVisionPath)) {
    session.status = 'failed';
    writeContinuousSession(root, session);
    return { ok: false, status: 'failed', action: 'vision_missing', stop_reason: `VISION.md not found at ${absVisionPath}` };
  }

  // Step 1: Check intake queue for pending work (BUG-34: scope to current run)
  const queued = findNextDispatchableIntent(root, { run_id: session.current_run_id });
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

  // Execute the governed run
  session.current_run_id = preparedIntent.run_id;
  session.current_vision_objective = visionObjective || preparedIntent.intent?.charter || null;
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
    const blockedRecoveryAction = getBlockedRecoveryAction(execution?.result?.state || loadProjectState(root, context.config));
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
