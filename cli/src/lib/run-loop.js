/**
 * Run Loop — reusable governed-execution engine.
 *
 * Drives repeated governed turns to a terminal state, yielding control at
 * well-defined pause points. Any runner (CLI, CI, hosted, custom) composes
 * this to implement continuous governed delivery.
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
  RUNNER_INTERFACE_VERSION,
} from './runner-interface.js';

import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const DEFAULT_MAX_TURNS = 50;

/**
 * Drive governed turns to a terminal state.
 *
 * @param {string} root - project root directory
 * @param {object} config - normalized governed config
 * @param {object} callbacks - { selectRole, dispatch, approveGate, onEvent? }
 * @param {object} [options] - { maxTurns?: number }
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
  if (!state || state.status === 'idle') {
    const initResult = initRun(root, config);
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

    // ── Check for active turn (retry after rejection) ──────────────────��
    let turn;
    let assignState;
    const activeTurn = getActiveTurn(state);

    if (activeTurn && (activeTurn.status === 'running' || activeTurn.status === 'retrying')) {
      // Re-dispatch an existing active turn (retry after rejection)
      turn = activeTurn;
      assignState = state;
    } else {
      // ── Role selection ────────────────────────────────────────────────
      let roleId;
      try {
        roleId = callbacks.selectRole(state, config);
      } catch (err) {
        errors.push(`selectRole threw: ${err.message}`);
        return makeResult(false, 'dispatch_error', state, turnsExecuted, turnHistory, gatesApproved, errors);
      }

      if (roleId === null || roleId === undefined) {
        emit({ type: 'caller_stopped', state });
        return makeResult(false, 'caller_stopped', state, turnsExecuted, turnHistory, gatesApproved, errors);
      }

      // ── Turn assignment ───────────────────────────────────────────────
      const assignResult = assignTurn(root, config, roleId);
      if (!assignResult.ok) {
        errors.push(`assignTurn(${roleId}): ${assignResult.error}`);
        return makeResult(false, 'blocked', loadState(root, config), turnsExecuted, turnHistory, gatesApproved, errors);
      }
      turn = assignResult.turn;
      assignState = assignResult.state;
      emit({ type: 'turn_assigned', turn, role: roleId, state: assignState });
    }

    const roleId = turn.assigned_role;

    // ── Dispatch bundle ─────────────────────────────────────────────────
    const bundleResult = writeDispatchBundle(root, assignState, config);
    if (!bundleResult.ok) {
      errors.push(`writeDispatchBundle(${roleId}): ${bundleResult.error}`);
      return makeResult(false, 'blocked', loadState(root, config), turnsExecuted, turnHistory, gatesApproved, errors);
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

    // ── Dispatch ────────────────────────────────────────────────────────
    let dispatchResult;
    try {
      dispatchResult = await callbacks.dispatch(context);
    } catch (err) {
      errors.push(`dispatch threw for ${roleId}: ${err.message}`);
      return makeResult(false, 'dispatch_error', loadState(root, config), turnsExecuted, turnHistory, gatesApproved, errors);
    }

    if (dispatchResult.accept) {
      // Stage the turn result
      const absStaging = join(root, stagingPath);
      mkdirSync(dirname(absStaging), { recursive: true });
      writeFileSync(absStaging, JSON.stringify(dispatchResult.turnResult, null, 2));

      // Accept
      const acceptResult = acceptTurn(root, config);
      if (!acceptResult.ok) {
        errors.push(`acceptTurn(${roleId}): ${acceptResult.error}`);
        const postState = loadState(root, config);
        return makeResult(false, 'blocked', postState, turnsExecuted, turnHistory, gatesApproved, errors);
      }

      turnsExecuted++;
      turnHistory.push({ role: roleId, turn_id: turn.turn_id, accepted: true });
      emit({ type: 'turn_accepted', turn, role: roleId, state: acceptResult.state });

    } else {
      // Rejection
      const validationResult = {
        stage: 'dispatch',
        errors: [dispatchResult.reason || 'Dispatch callback rejected the turn'],
      };
      rejectTurn(root, config, validationResult, dispatchResult.reason || 'Dispatch rejection');
      turnHistory.push({ role: roleId, turn_id: turn.turn_id, accepted: false });
      emit({ type: 'turn_rejected', turn, role: roleId, reason: dispatchResult.reason });

      // Check if retries exhausted → run blocked
      const postRejectState = loadState(root, config);
      if (postRejectState?.status === 'blocked') {
        errors.push(`Turn rejected for ${roleId}, retries exhausted`);
        emit({ type: 'blocked', state: postRejectState });
        return makeResult(false, 'reject_exhausted', postRejectState, turnsExecuted, turnHistory, gatesApproved, errors);
      }
      // Otherwise continue — loop will detect the active turn and re-dispatch
    }
  }
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
