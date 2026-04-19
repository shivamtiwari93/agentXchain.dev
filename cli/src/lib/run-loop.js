/**
 * Run Loop — reusable governed-execution engine.
 *
 * Drives repeated governed turns to a terminal state, yielding control at
 * well-defined pause points. Any runner (CLI, CI, hosted, custom) composes
 * this to implement continuous governed delivery.
 *
 * Supports parallel turn dispatch when max_concurrent_turns > 1 is configured
 * for the current phase (DEC-PARALLEL-RUN-LOOP-001).
 *
 * Design rules:
 *   - Never calls process dot exit
 *   - No stdout/stderr
 *   - No adapter dispatch (caller provides dispatch callback)
 *   - Governed lifecycle operations import through runner-interface.js
 */

import {
  loadState,
  initRun,
  assignTurn,
  acceptTurn,
  rejectTurn,
  markRunBlocked,
  writeDispatchBundle,
  refreshTurnBaselineSnapshot,
  getTurnStagingResultPath,
  approvePhaseGate,
  approveCompletionGate,
  getActiveTurn,
  getActiveTurnCount,
  getActiveTurns,
  getMaxConcurrentTurns,
  RUNNER_INTERFACE_VERSION,
} from './runner-interface.js';

import { runAdmissionControl } from './admission-control.js';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { evaluateApprovalSlaReminders } from './notification-runner.js';
import { validatePreemptionMarker } from './intake.js';
import { buildTimeoutBlockedReason, evaluateTimeouts } from './timeout-evaluator.js';

const DEFAULT_MAX_TURNS = 50;

/**
 * Drive governed turns to a terminal state.
 *
 * When max_concurrent_turns > 1 for the current phase, the loop fills
 * available concurrency slots and dispatches all active turns concurrently.
 * Acceptance is serialized by the existing lock mechanism.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized governed config
 * @param {object} callbacks - { selectRole, dispatch, approveGate, onEvent? }
 * @param {object} [options] - { maxTurns?: number, provenance?: object, startNewRunFromCompleted?: boolean, startNewRunFromBlocked?: boolean }
 * @returns {Promise<RunLoopResult>}
 */
export async function runLoop(root, config, callbacks, options = {}) {
  const maxTurns = options.maxTurns ?? config.run_loop?.max_turns ?? DEFAULT_MAX_TURNS;
  let turnsExecuted = 0;
  const turnHistory = [];
  let gatesApproved = 0;
  const errors = [];
  const emit = (event) => {
    if (!callbacks.onEvent) return;
    try {
      callbacks.onEvent(event);
    } catch (err) {
      errors.push(`onEvent threw for ${event?.type || 'unknown'}: ${err.message}`);
    }
  };

  // ── Admission control — reject provably dead-end configs ────────────────
  const admission = runAdmissionControl(config, config);
  if (!admission.ok) {
    return makeResult(false, 'admission_rejected', null, 0, [], 0,
      admission.errors.map(e => `Admission control: ${e}`));
  }

  // ── Initialize if idle ──────────────────────────────────────────────────
  let state = loadState(root, config);
  const shouldRestartCompleted = state?.status === 'completed' && options.startNewRunFromCompleted === true;
  const shouldRestartBlocked = state?.status === 'blocked' && options.startNewRunFromBlocked === true;
  if (!state || state.status === 'idle' || shouldRestartCompleted || shouldRestartBlocked) {
    const initOpts = options.provenance ? { provenance: options.provenance } : {};
    if (options.inheritedContext) {
      initOpts.inherited_context = options.inheritedContext;
    }
    if (shouldRestartCompleted || shouldRestartBlocked) {
      initOpts.allow_terminal_restart = true;
    }
    const initResult = initRun(root, config, initOpts);
    if (!initResult.ok) {
      return makeResult(false, 'init_failed', loadState(root, config), turnsExecuted, turnHistory, gatesApproved, [initResult.error]);
    }
    state = initResult.state;
  }

  // ── Main loop ───────────────────────────────────────────────────────────
  while (true) {
    state = loadState(root, config);
    if (!state) {
      errors.push('loadState returned null — state file missing or invalid');
      return makeResult(false, 'blocked', null, turnsExecuted, turnHistory, gatesApproved, errors);
    }

    // Terminal: completed
    if (state.status === 'completed') {
      emit({ type: 'completed', state });
      return makeResult(true, 'completed', state, turnsExecuted, turnHistory, gatesApproved, errors);
    }

    // Terminal: blocked
    if (state.status === 'blocked') {
      emit({ type: 'blocked', state });
      return makeResult(false, 'blocked', state, turnsExecuted, turnHistory, gatesApproved, errors);
    }

    // Paused: gate handling
    if (state.status === 'paused') {
      const gateOutcome = await handleGatePause(root, config, state, callbacks, emit);
      if (gateOutcome.continue) {
        gatesApproved += gateOutcome.approved ? 1 : 0;
        continue;
      }
      return makeResult(false, gateOutcome.stop_reason, loadState(root, config), turnsExecuted, turnHistory, gatesApproved, errors);
    }

    // Safety limit
    if (turnsExecuted >= maxTurns) {
      return makeResult(false, 'max_turns_reached', state, turnsExecuted, turnHistory, gatesApproved, errors);
    }

    // ── Priority preemption check ────────────────────────────────────────
    // If a p0 intent was injected via `agentxchain inject`, yield the run
    // so the scheduler/continuous loop can pick up the injected work.
    // Only preempt when no turns are currently active (avoid mid-dispatch
    // interruption).
    const activeTurnCount = getActiveTurnCount(state);
    if (activeTurnCount === 0) {
      // BUG-48: validate marker against live intent state before preempting
      const marker = validatePreemptionMarker(root);
      if (marker && marker.priority === 'p0') {
        emit({ type: 'priority_injected', intent_id: marker.intent_id, priority: marker.priority });
        const result = makeResult(false, 'priority_preempted', state, turnsExecuted, turnHistory, gatesApproved, errors);
        result.preempted_by = marker.intent_id;
        return result;
      }
    }

    // ── Determine concurrency mode ────────────────────────────────────────
    const maxConcurrent = getMaxConcurrentTurns(config, state.phase);

    if (maxConcurrent <= 1) {
      // ── Sequential mode (original behavior) ──────────────────────────
      const seqResult = await executeSequentialTurn(root, config, state, callbacks, emit, errors);
      if (seqResult.terminal) {
        return makeResult(seqResult.ok, seqResult.stop_reason, loadState(root, config), turnsExecuted, turnHistory, gatesApproved, errors);
      }
      if (seqResult.accepted) {
        turnsExecuted++;
      }
      turnHistory.push(...seqResult.history);
    } else {
      // ── Parallel mode ────────────────────────────────────────────────
      const parResult = await executeParallelTurns(root, config, state, maxConcurrent, callbacks, emit, errors);
      if (parResult.terminal) {
        return makeResult(parResult.ok, parResult.stop_reason, loadState(root, config), turnsExecuted, turnHistory, gatesApproved, errors);
      }
      turnsExecuted += parResult.acceptedCount;
      turnHistory.push(...parResult.history);
    }
  }
}

/**
 * Execute a single turn (sequential mode — original behavior preserved).
 */
async function executeSequentialTurn(root, config, state, callbacks, emit, errors) {
  let turn;
  let assignState;
  const activeTurn = getActiveTurn(state);

  if (activeTurn && (activeTurn.status === 'running' || activeTurn.status === 'retrying')) {
    turn = activeTurn;
    assignState = state;
  } else {
    let roleId;
    try {
      roleId = callbacks.selectRole(state, config);
    } catch (err) {
      errors.push(`selectRole threw: ${err.message}`);
      return { terminal: true, ok: false, stop_reason: 'dispatch_error', history: [] };
    }

    if (roleId === null || roleId === undefined) {
      emit({ type: 'caller_stopped', state });
      return { terminal: true, ok: false, stop_reason: 'caller_stopped', history: [] };
    }

    const assignResult = assignTurn(root, config, roleId);
    if (!assignResult.ok) {
      errors.push(`assignTurn(${roleId}): ${assignResult.error}`);
      return { terminal: true, ok: false, stop_reason: 'blocked', history: [] };
    }
    turn = assignResult.turn;
    assignState = assignResult.state;
    emit({ type: 'turn_assigned', turn, role: roleId, state: assignState });
  }

  return await dispatchAndProcess(root, config, turn, assignState, callbacks, emit, errors);
}

/**
 * Fill concurrency slots and dispatch all active turns concurrently.
 */
async function executeParallelTurns(root, config, state, maxConcurrent, callbacks, emit, errors) {
  const history = [];
  let acceptedCount = 0;
  const timedOutDispatches = [];

  // ── Collect active turns that need dispatch (retries) ────────────────
  const activeTurns = getActiveTurns(state);
  const turnsToDispatch = [];
  for (const turn of Object.values(activeTurns)) {
    if (turn.status === 'running' || turn.status === 'retrying') {
      turnsToDispatch.push({ turn, state });
    }
  }

  // ── Fill concurrency slots with new assignments ──────────────────────
  let activeCount = getActiveTurnCount(state);
  const triedRoles = new Set();
  while (activeCount < maxConcurrent) {
    let roleId;
    try {
      roleId = callbacks.selectRole(state, config);
    } catch (err) {
      errors.push(`selectRole threw: ${err.message}`);
      break;
    }

    if (roleId === null || roleId === undefined) {
      // No more roles to assign — dispatch what we have
      break;
    }

    // If selectRole returns a role we already tried (or assigned), try
    // other eligible roles from the routing before giving up.
    // Exception: when delegation queue is driving resolution, do not fill
    // extra slots with non-delegation roles via the fallback — those roles
    // would execute without delegation context and corrupt the lifecycle.
    if (triedRoles.has(roleId)) {
      const hasPendingDelegations = Array.isArray(state?.delegation_queue) &&
        state.delegation_queue.some(d => d.status === 'pending' || d.status === 'active');
      const hasPendingReview = !!state?.pending_delegation_review;
      if (hasPendingDelegations || hasPendingReview) {
        break;
      }
      const phase = state.phase;
      const allowed = config?.routing?.[phase]?.allowed_next_roles || [];
      const alternateFound = allowed.some((alt) => {
        if (alt === 'human' || triedRoles.has(alt) || !config?.roles?.[alt]) return false;
        const altResult = assignTurn(root, config, alt);
        if (altResult.ok) {
          triedRoles.add(alt);
          turnsToDispatch.push({ turn: altResult.turn, state: altResult.state });
          emit({ type: 'turn_assigned', turn: altResult.turn, role: alt, state: altResult.state });
          state = loadState(root, config);
          activeCount = getActiveTurnCount(state);
          return true;
        }
        triedRoles.add(alt);
        return false;
      });
      if (!alternateFound) break;
      continue;
    }

    triedRoles.add(roleId);
    const assignResult = assignTurn(root, config, roleId);
    if (!assignResult.ok) {
      // Cannot assign — try other eligible roles before giving up
      continue;
    }

    turnsToDispatch.push({ turn: assignResult.turn, state: assignResult.state });
    emit({ type: 'turn_assigned', turn: assignResult.turn, role: roleId, state: assignResult.state });

    // Delegation review is a coordination checkpoint — do not fill additional
    // slots alongside it.  The review must execute alone so it can assess all
    // delegation results before the run continues.
    if (assignResult.turn.delegation_review) {
      break;
    }

    // Reload state after assignment to get accurate active count
    state = loadState(root, config);
    activeCount = getActiveTurnCount(state);
  }

  // ── Nothing to dispatch? ─────────────────────────────────────────────
  if (turnsToDispatch.length === 0) {
    // selectRole returned null with no active turns — caller is done
    emit({ type: 'caller_stopped', state });
    return { terminal: true, ok: false, stop_reason: 'caller_stopped', history: [] };
  }

  // ── Build dispatch contexts ──────────────────────────────────────────
  const contexts = [];
  for (const { turn, state: turnState } of turnsToDispatch) {
    // BUG-1 fix: refresh baseline to capture files dirtied between assignment and dispatch
    refreshTurnBaselineSnapshot(root, turn.turn_id);
    const bundleResult = writeDispatchBundle(root, turnState, config, { turnId: turn.turn_id });
    if (!bundleResult.ok) {
      errors.push(`writeDispatchBundle(${turn.assigned_role}): ${bundleResult.error}`);
      continue;
    }
    const stagingPath = getTurnStagingResultPath(turn.turn_id);
    contexts.push({
      turn,
      state: turnState,
      bundlePath: bundleResult.bundlePath,
      stagingPath,
      config,
      root,
    });
  }

  if (contexts.length === 0) {
    errors.push('All dispatch bundles failed to write');
    return { terminal: true, ok: false, stop_reason: 'blocked', history: [] };
  }

  // ── Dispatch concurrently ────────────────────────────────────────────
  emit({ type: 'parallel_dispatch', count: contexts.length, turns: contexts.map(c => c.turn.turn_id) });

  const dispatchResults = await Promise.allSettled(
    contexts.map(async (ctx) => {
      try {
        return { ctx, result: await dispatchWithTimeout(ctx, config, callbacks.dispatch) };
      } catch (err) {
        return { ctx, result: { accept: false, reason: `dispatch threw: ${err.message}` } };
      }
    })
  );

  // ── Process results sequentially (acceptance is lock-serialized) ─────
  for (const settled of dispatchResults) {
    const { ctx, result: dispatchResult } = settled.status === 'fulfilled'
      ? settled.value
      : { ctx: null, result: { accept: false, reason: `Promise rejected: ${settled.reason}` } };

    if (!ctx) continue;

    const { turn } = ctx;
    const roleId = turn.assigned_role;

    if (dispatchResult?.timed_out === true) {
      timedOutDispatches.push({ ctx, dispatchResult });
      continue;
    }

    if (dispatchResult.accept) {
      const absStaging = join(root, ctx.stagingPath);
      mkdirSync(dirname(absStaging), { recursive: true });
      writeFileSync(absStaging, JSON.stringify(dispatchResult.turnResult, null, 2));

      const acceptResult = acceptTurn(root, config, { turnId: turn.turn_id });
      if (!acceptResult.ok) {
        errors.push(`acceptTurn(${roleId}): ${acceptResult.error}`);

        // Conflict-aware handling (DEC-RUN-LOOP-CONFLICT-001)
        if (acceptResult.error_code === 'conflict') {
          history.push({
            role: roleId, turn_id: turn.turn_id, accepted: false,
            error_code: 'conflict', accept_error: acceptResult.error,
            conflict: acceptResult.conflict,
          });
          emit({
            type: 'turn_conflicted', turn, role: roleId,
            error_code: 'conflict', conflict: acceptResult.conflict,
            state: acceptResult.state,
          });
          if (acceptResult.state?.status === 'blocked') {
            emit({ type: 'blocked', state: acceptResult.state });
            return { terminal: true, ok: false, stop_reason: 'conflict_loop', history, acceptedCount };
          }
          continue;
        }

        // Record failure but try other turns
        history.push({ role: roleId, turn_id: turn.turn_id, accepted: false, accept_error: acceptResult.error });
        continue;
      }

      acceptedCount++;
      history.push({ role: roleId, turn_id: turn.turn_id, accepted: true });
      if (callbacks.afterAccept) {
        const afterAcceptResult = await callbacks.afterAccept({ turn, acceptResult });
        if (afterAcceptResult?.ok === false) {
          errors.push(`afterAccept(${roleId}): ${afterAcceptResult.error}`);
          if (afterAcceptResult.state) {
            emit({ type: 'blocked', state: afterAcceptResult.state, reason: 'after_accept_failed' });
          }
          return { terminal: true, ok: false, stop_reason: 'blocked', history, acceptedCount };
        }
      }
      emit({ type: 'turn_accepted', turn, role: roleId, state: acceptResult.state });
    } else {
      const validationResult = {
        stage: 'dispatch',
        errors: [dispatchResult.reason || 'Dispatch callback rejected the turn'],
      };
      rejectTurn(root, config, validationResult, dispatchResult.reason || 'Dispatch rejection', { turnId: turn.turn_id });
      history.push({ role: roleId, turn_id: turn.turn_id, accepted: false });
      emit({ type: 'turn_rejected', turn, role: roleId, reason: dispatchResult.reason });

      // Check if rejection blocked the run
      const postRejectState = loadState(root, config);
      if (postRejectState?.status === 'blocked') {
        errors.push(`Turn rejected for ${roleId}, retries exhausted`);
        emit({ type: 'blocked', state: postRejectState });
        return { terminal: true, ok: false, stop_reason: 'reject_exhausted', history, acceptedCount };
      }
    }
  }

  if (timedOutDispatches.length > 0) {
    const timedOut = timedOutDispatches[0];
    const blocked = persistDispatchTimeout(root, config, timedOut.ctx.turn, timedOut.dispatchResult.timeout_result, errors);
    emit({ type: 'blocked', state: blocked.state, reason: 'timeout:turn' });
    return { terminal: true, ok: false, stop_reason: 'blocked', history, acceptedCount };
  }

  // ── Stall detection: if no turns were accepted and no new roles were ──
  // ── assignable, terminate to avoid infinite re-dispatch loops. ────────
  if (acceptedCount === 0 && history.length > 0) {
    const allFailed = history.every(h => !h.accepted);
    if (allFailed) {
      const allConflicts = history.every(h => h.error_code === 'conflict');
      const stopReason = allConflicts ? 'conflict_stall' : 'blocked';
      errors.push(`All parallel turns failed acceptance — ${stopReason}`);
      return { terminal: true, ok: false, stop_reason: stopReason, history, acceptedCount };
    }
  }

  return { terminal: false, history, acceptedCount };
}

/**
 * Dispatch a single turn and process its result.
 */
async function dispatchAndProcess(root, config, turn, assignState, callbacks, emit, errors) {
  const roleId = turn.assigned_role;
  const history = [];

  // BUG-1 fix: refresh baseline to capture files dirtied between assignment and dispatch
  refreshTurnBaselineSnapshot(root, turn.turn_id);
  const bundleResult = writeDispatchBundle(root, assignState, config);
  if (!bundleResult.ok) {
    errors.push(`writeDispatchBundle(${roleId}): ${bundleResult.error}`);
    return { terminal: true, ok: false, stop_reason: 'blocked', history };
  }

  const stagingPath = getTurnStagingResultPath(turn.turn_id);
  const context = {
    turn,
    state: assignState,
    bundlePath: bundleResult.bundlePath,
    stagingPath,
    config,
    root,
  };

  let dispatchResult;
  try {
    dispatchResult = await dispatchWithTimeout(context, config, callbacks.dispatch);
  } catch (err) {
    errors.push(`dispatch threw for ${roleId}: ${err.message}`);
    return { terminal: true, ok: false, stop_reason: 'dispatch_error', history };
  }

  if (dispatchResult?.timed_out === true) {
    const blocked = persistDispatchTimeout(root, config, turn, dispatchResult.timeout_result, errors);
    emit({ type: 'blocked', state: blocked.state, reason: 'timeout:turn' });
    return { terminal: true, ok: false, stop_reason: 'blocked', history };
  }

  if (dispatchResult.accept) {
    const absStaging = join(root, stagingPath);
    mkdirSync(dirname(absStaging), { recursive: true });
    writeFileSync(absStaging, JSON.stringify(dispatchResult.turnResult, null, 2));

    const acceptResult = acceptTurn(root, config);
    if (!acceptResult.ok) {
      errors.push(`acceptTurn(${roleId}): ${acceptResult.error}`);

      // Conflict-aware handling (DEC-RUN-LOOP-CONFLICT-001)
      if (acceptResult.error_code === 'conflict') {
        history.push({
          role: roleId, turn_id: turn.turn_id, accepted: false,
          error_code: 'conflict', accept_error: acceptResult.error,
          conflict: acceptResult.conflict,
        });
        emit({
          type: 'turn_conflicted', turn, role: roleId,
          error_code: 'conflict', conflict: acceptResult.conflict,
          state: acceptResult.state,
        });
        // If the resulting state is blocked (conflict_loop), terminate
        if (acceptResult.state?.status === 'blocked') {
          emit({ type: 'blocked', state: acceptResult.state });
          return { terminal: true, ok: false, stop_reason: 'conflict_loop', history };
        }
        // Otherwise the turn is conflicted but the run is still active — let the
        // main loop re-enter and try another role or handle the paused state
        return { terminal: false, accepted: false, history };
      }

      return { terminal: true, ok: false, stop_reason: 'blocked', history };
    }

    history.push({ role: roleId, turn_id: turn.turn_id, accepted: true });
    if (callbacks.afterAccept) {
      const afterAcceptResult = await callbacks.afterAccept({ turn, acceptResult });
      if (afterAcceptResult?.ok === false) {
        errors.push(`afterAccept(${roleId}): ${afterAcceptResult.error}`);
        if (afterAcceptResult.state) {
          emit({ type: 'blocked', state: afterAcceptResult.state, reason: 'after_accept_failed' });
        }
        return { terminal: true, ok: false, stop_reason: 'blocked', history };
      }
    }
    emit({ type: 'turn_accepted', turn, role: roleId, state: acceptResult.state });
    return { terminal: false, accepted: true, history };
  }

  // Rejection
  const validationResult = {
    stage: 'dispatch',
    errors: [dispatchResult.reason || 'Dispatch callback rejected the turn'],
  };
  rejectTurn(root, config, validationResult, dispatchResult.reason || 'Dispatch rejection');
  history.push({ role: roleId, turn_id: turn.turn_id, accepted: false });
  emit({ type: 'turn_rejected', turn, role: roleId, reason: dispatchResult.reason });

  const postRejectState = loadState(root, config);
  if (postRejectState?.status === 'blocked') {
    errors.push(`Turn rejected for ${roleId}, retries exhausted`);
    emit({ type: 'blocked', state: postRejectState });
    return { terminal: true, ok: false, stop_reason: 'reject_exhausted', history };
  }

  return { terminal: false, accepted: false, history };
}

/**
 * Handle a paused state by checking for pending gates and calling approveGate.
 */
async function handleGatePause(root, config, state, callbacks, emit) {
  evaluateApprovalSlaReminders(root, config, state);

  if (state.pending_phase_transition) {
    emit({ type: 'gate_paused', gateType: 'phase_transition', state });
    let approved;
    try {
      approved = await callbacks.approveGate('phase_transition', state);
    } catch (err) {
      return { continue: false, stop_reason: 'blocked', approved: false };
    }
    if (approved) {
      const gateResult = approvePhaseGate(root, config);
      if (!gateResult.ok) {
        return { continue: false, stop_reason: 'blocked', approved: false };
      }
      emit({ type: 'gate_approved', gateType: 'phase_transition', state: loadState(root, config) });
      return { continue: true, approved: true };
    }
    emit({ type: 'gate_held', gateType: 'phase_transition', state });
    return { continue: false, stop_reason: 'gate_held', approved: false };
  }

  if (state.pending_run_completion) {
    emit({ type: 'gate_paused', gateType: 'run_completion', state });
    let approved;
    try {
      approved = await callbacks.approveGate('run_completion', state);
    } catch (err) {
      return { continue: false, stop_reason: 'blocked', approved: false };
    }
    if (approved) {
      const gateResult = approveCompletionGate(root, config);
      if (!gateResult.ok) {
        return { continue: false, stop_reason: 'blocked', approved: false };
      }
      emit({ type: 'gate_approved', gateType: 'run_completion', state: loadState(root, config) });
      return { continue: true, approved: true };
    }
    emit({ type: 'gate_held', gateType: 'run_completion', state });
    return { continue: false, stop_reason: 'gate_held', approved: false };
  }

  // Paused without a known gate — treat as blocked
  return { continue: false, stop_reason: 'blocked', approved: false };
}

function makeResult(ok, stop_reason, state, turns_executed, turn_history, gates_approved, errors) {
  return {
    ok,
    stop_reason,
    state: state || null,
    turns_executed,
    turn_history,
    gates_approved,
    errors,
  };
}

function noop() {}

export { DEFAULT_MAX_TURNS };

function buildTimeoutLedgerEntry(timeoutResult, timestamp, turnId, phase) {
  return {
    type: 'timeout',
    scope: timeoutResult.scope,
    phase: timeoutResult.phase || phase || null,
    turn_id: turnId || null,
    limit_minutes: timeoutResult.limit_minutes,
    elapsed_minutes: timeoutResult.elapsed_minutes,
    exceeded_by_minutes: timeoutResult.exceeded_by_minutes,
    action: timeoutResult.action,
    timestamp,
  };
}

function appendJsonl(root, relPath, value) {
  appendFileSync(join(root, relPath), `${JSON.stringify(value)}\n`);
}

function getDispatchTimeoutResult(config, state, turn, now = new Date()) {
  const evaluation = evaluateTimeouts({ config, state, turn, now });
  return evaluation.exceeded.find((entry) => entry.scope === 'turn' && entry.action === 'escalate') || null;
}

async function dispatchWithTimeout(context, config, dispatchFn) {
  const timeoutResult = getDispatchTimeoutResult(config, context.state, context.turn);
  if (!timeoutResult) {
    return await dispatchFn(context);
  }

  const remainingMs = Math.max(
    0,
    timeoutResult.limit_minutes * 60 * 1000
      - Math.max(0, new Date() - new Date(context.turn.started_at || context.turn.assigned_at || new Date())),
  );
  const abortController = new AbortController();
  if (remainingMs === 0) {
    abortController.abort(new Error(`Turn timeout exceeded after ${timeoutResult.limit_minutes}m`));
    return {
      timed_out: true,
      timeout_result: timeoutResult,
    };
  }
  const enrichedContext = {
    ...context,
    dispatchTimeoutMs: remainingMs,
    dispatchDeadlineAt: new Date(Date.now() + remainingMs).toISOString(),
    dispatchAbortSignal: abortController.signal,
  };

  let timer = null;
  const dispatchPromise = Promise.resolve(dispatchFn(enrichedContext))
    .then((result) => ({ kind: 'result', result }))
    .catch((error) => ({ kind: 'error', error }));
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      abortController.abort(new Error(`Turn timeout exceeded after ${timeoutResult.limit_minutes}m`));
      resolve({ kind: 'timeout', timeoutResult });
    }, remainingMs);
  });

  const winner = await Promise.race([dispatchPromise, timeoutPromise]);
  clearTimeout(timer);

  if (winner.kind === 'timeout') {
    return {
      timed_out: true,
      timeout_result: winner.timeoutResult,
    };
  }

  if (winner.kind === 'error') {
    throw winner.error;
  }

  return winner.result;
}

function persistDispatchTimeout(root, config, turn, timeoutResult, errors) {
  const blockedAt = new Date().toISOString();
  const blockedReason = buildTimeoutBlockedReason(timeoutResult, { turnRetained: true });
  const blocked = markRunBlocked(root, {
    blockedOn: `timeout:${timeoutResult.scope}`,
    category: blockedReason.category,
    recovery: blockedReason.recovery,
    turnId: turn.turn_id,
    blockedAt,
    notificationConfig: config,
  });

  if (!blocked.ok) {
    errors.push(`markRunBlocked(timeout): ${blocked.error}`);
    return { state: loadState(root, config) };
  }

  try {
    appendJsonl(root, '.agentxchain/decision-ledger.jsonl', buildTimeoutLedgerEntry(timeoutResult, blockedAt, turn.turn_id, blocked.state?.phase));
  } catch (err) {
    errors.push(`timeout ledger append failed: ${err.message}`);
  }

  errors.push(`dispatch timed out for ${turn.assigned_role} after ${timeoutResult.limit_minutes}m`);
  return blocked;
}
