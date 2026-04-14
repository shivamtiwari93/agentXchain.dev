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
 *   - Imports only from runner-interface.js
 */

import {
  loadState,
  initRun,
  assignTurn,
  acceptTurn,
  rejectTurn,
  writeDispatchBundle,
  getTurnStagingResultPath,
  approvePhaseGate,
  approveCompletionGate,
  getActiveTurn,
  getActiveTurnCount,
  getActiveTurns,
  getMaxConcurrentTurns,
  RUNNER_INTERFACE_VERSION,
} from './runner-interface.js';

import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

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
    if (triedRoles.has(roleId)) {
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
        return { ctx, result: await callbacks.dispatch(ctx) };
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

    if (dispatchResult.accept) {
      const absStaging = join(root, ctx.stagingPath);
      mkdirSync(dirname(absStaging), { recursive: true });
      writeFileSync(absStaging, JSON.stringify(dispatchResult.turnResult, null, 2));

      const acceptResult = acceptTurn(root, config, { turnId: turn.turn_id });
      if (!acceptResult.ok) {
        errors.push(`acceptTurn(${roleId}): ${acceptResult.error}`);
        // Record failure but try other turns
        history.push({ role: roleId, turn_id: turn.turn_id, accepted: false, accept_error: acceptResult.error });
        continue;
      }

      acceptedCount++;
      history.push({ role: roleId, turn_id: turn.turn_id, accepted: true });
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

  // ── Stall detection: if no turns were accepted and no new roles were ──
  // ── assignable, terminate to avoid infinite re-dispatch loops. ────────
  if (acceptedCount === 0 && history.length > 0) {
    const allFailed = history.every(h => !h.accepted);
    if (allFailed) {
      errors.push('All parallel turns failed acceptance — stalled');
      return { terminal: true, ok: false, stop_reason: 'blocked', history, acceptedCount };
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
    dispatchResult = await callbacks.dispatch(context);
  } catch (err) {
    errors.push(`dispatch threw for ${roleId}: ${err.message}`);
    return { terminal: true, ok: false, stop_reason: 'dispatch_error', history };
  }

  if (dispatchResult.accept) {
    const absStaging = join(root, stagingPath);
    mkdirSync(dirname(absStaging), { recursive: true });
    writeFileSync(absStaging, JSON.stringify(dispatchResult.turnResult, null, 2));

    const acceptResult = acceptTurn(root, config);
    if (!acceptResult.ok) {
      errors.push(`acceptTurn(${roleId}): ${acceptResult.error}`);
      return { terminal: true, ok: false, stop_reason: 'blocked', history };
    }

    history.push({ role: roleId, turn_id: turn.turn_id, accepted: true });
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
