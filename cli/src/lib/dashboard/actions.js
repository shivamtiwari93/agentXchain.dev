import { dirname } from 'path';
import { loadProjectContext } from '../config.js';
import { approvePhaseTransition, approveRunCompletion } from '../governed-state.js';
import { deriveGovernedRunNextActions, deriveRecoveryDescriptor } from '../blocked-state.js';
import {
  deriveCoordinatorGateNextActions,
  normalizeCoordinatorGateApprovalFailure,
} from '../coordinator-gate-approval.js';
import { loadCoordinatorConfig } from '../coordinator-config.js';
import { loadCoordinatorState } from '../coordinator-state.js';
import { buildGatePayload, fireCoordinatorHook } from '../coordinator-hooks.js';
import { approveCoordinatorCompletion, approveCoordinatorPhaseTransition } from '../coordinator-gates.js';
import { readJsonFile } from './state-reader.js';

function buildError(status, code, error, extra = {}) {
  return {
    status,
    body: {
      ok: false,
      code,
      error,
      ...extra,
    },
  };
}

function normalizeRepoSuccess(result, gateType) {
  const nextActions = gateType === 'phase_transition'
    ? [
        {
          command: 'agentxchain step',
          reason: `Run is active in phase "${result.state?.phase || 'unknown'}" and can continue.`,
        },
      ]
    : [];
  const nextAction = nextActions[0]?.command ?? null;

  if (gateType === 'phase_transition') {
    return {
      status: 200,
      body: {
        ok: true,
        scope: 'repo',
        gate_type: 'phase_transition',
        status: result.state?.status || null,
        phase: result.state?.phase || null,
        message: `Phase transition approved: ${result.transition.from} -> ${result.transition.to}`,
        next_action: nextAction,
        next_actions: nextActions,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      scope: 'repo',
      gate_type: 'run_completion',
      status: result.state?.status || null,
      phase: result.state?.phase || null,
      message: 'Run completion approved. Run is now completed.',
      next_action: nextAction,
      next_actions: nextActions,
    },
  };
}

function deriveRepoHookName(result) {
  return result?.hookResults?.blocker?.hook_name
    || result?.hookResults?.results?.find((entry) => entry?.hook_name)?.hook_name
    || null;
}

function buildRecoverySummary(recovery) {
  if (!recovery || typeof recovery !== 'object') {
    return null;
  }

  return {
    typed_reason: recovery.typed_reason || 'approval_failed',
    owner: recovery.owner || 'human',
    recovery_action: recovery.recovery_action || null,
    detail: recovery.detail ?? null,
    turn_retained: typeof recovery.turn_retained === 'boolean' ? recovery.turn_retained : false,
    runtime_guidance: Array.isArray(recovery.runtime_guidance) ? recovery.runtime_guidance : [],
  };
}

function normalizeRepoFailure(result, config) {
  const recovery = result.state ? deriveRecoveryDescriptor(result.state, config) : null;
  const nextActions = result.state ? deriveGovernedRunNextActions(result.state, config) : [];
  const nextAction = nextActions[0]?.command || recovery?.recovery_action || null;
  const code = result.error_code || 'approval_failed';
  const gateType = result.state?.pending_phase_transition
    ? 'phase_transition'
    : result.state?.pending_run_completion
      ? 'run_completion'
      : null;
  const gate = result.state?.pending_phase_transition?.gate
    || result.state?.pending_run_completion?.gate
    || null;
  const hookPhase = code.startsWith('hook_') ? 'before_gate' : null;
  return buildError(409, code, result.error || 'Gate approval failed', {
    scope: 'repo',
    gate,
    gate_type: gateType,
    hook_phase: hookPhase,
    hook_name: hookPhase ? deriveRepoHookName(result) : null,
    next_action: nextAction,
    next_actions: nextActions,
    recovery_summary: buildRecoverySummary(recovery),
  });
}

function approveRepoGate(root, config, state) {
  const gateType = state.pending_phase_transition ? 'phase_transition' : 'run_completion';
  const result = gateType === 'phase_transition'
    ? approvePhaseTransition(root, config)
    : approveRunCompletion(root, config);

  if (!result.ok) {
    return normalizeRepoFailure(result, config);
  }

  return normalizeRepoSuccess(result, gateType);
}

function normalizeCoordinatorSuccess(result, gateType, config) {
  const nextActions = deriveCoordinatorGateNextActions(result.state, config);
  const nextAction = nextActions[0]?.command ?? null;

  if (gateType === 'phase_transition') {
    return {
      status: 200,
      body: {
        ok: true,
        scope: 'coordinator',
        gate_type: 'phase_transition',
        status: result.state?.status || null,
        phase: result.state?.phase || null,
        message: `Coordinator phase transition approved: ${result.transition.from} -> ${result.transition.to}`,
        next_action: nextAction,
        next_actions: nextActions,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      scope: 'coordinator',
      gate_type: 'run_completion',
      status: result.state?.status || null,
      phase: result.state?.phase || null,
      message: 'Coordinator run completion approved. Run is now complete.',
      next_action: nextAction,
      next_actions: nextActions,
    },
  };
}

function approveCoordinatorGate(workspacePath, state, config) {
  const gatePayload = buildGatePayload(state.pending_gate, state);
  const gateHook = fireCoordinatorHook(workspacePath, config, 'before_gate', gatePayload, {
    super_run_id: state.super_run_id,
  });

  if (gateHook.blocked) {
    const blocker = gateHook.verdicts.find((entry) => entry.verdict === 'block');
    const reason = blocker?.message || 'before_gate hook blocked approval';
    return {
      status: 409,
      body: normalizeCoordinatorGateApprovalFailure({
        state,
        config,
        code: 'hook_blocked',
        error: reason,
        hookName: blocker?.hook_name || null,
        hookPhase: 'before_gate',
      }),
    };
  }

  if (!gateHook.ok) {
    return {
      status: 409,
      body: normalizeCoordinatorGateApprovalFailure({
        state,
        config,
        code: 'hook_failed',
        error: gateHook.error || 'before_gate hook failed',
        hookName: gateHook.results?.find((entry) => entry?.hook_name)?.hook_name || null,
        hookPhase: 'before_gate',
      }),
    };
  }

  const gateType = state.pending_gate.gate_type;
  let result;

  if (gateType === 'phase_transition') {
    result = approveCoordinatorPhaseTransition(workspacePath, state, config);
  } else if (gateType === 'run_completion') {
    result = approveCoordinatorCompletion(workspacePath, state, config);
  } else {
    return buildError(400, 'unknown_gate_type', `Unknown gate type: "${gateType}"`);
  }

  if (!result.ok) {
    return {
      status: 409,
      body: normalizeCoordinatorGateApprovalFailure({
        state,
        config,
        code: 'approval_failed',
        error: result.error || 'Coordinator gate approval failed',
      }),
    };
  }

  return normalizeCoordinatorSuccess(result, gateType, config);
}

export function approvePendingDashboardGate(agentxchainDir) {
  const workspacePath = dirname(agentxchainDir);
  const repoState = readJsonFile(agentxchainDir, 'state.json');

  if (repoState?.pending_phase_transition || repoState?.pending_run_completion) {
    const context = loadProjectContext(workspacePath);
    return approveRepoGate(workspacePath, context?.config, repoState);
  }

  const coordinatorState = readJsonFile(agentxchainDir, 'multirepo/state.json');
  if (coordinatorState?.pending_gate) {
    const configResult = loadCoordinatorConfig(workspacePath);
    if (!configResult.ok) {
      const detail = (configResult.errors || [])
        .map((entry) => typeof entry === 'string' ? entry : entry.message || JSON.stringify(entry))
        .join('; ');
      return buildError(400, 'coordinator_config_error', detail || 'Coordinator config error');
    }

    const loadedState = loadCoordinatorState(workspacePath) || coordinatorState;
    return approveCoordinatorGate(workspacePath, loadedState, configResult.config);
  }

  return buildError(409, 'no_pending_gate', 'No pending repo or coordinator gate to approve.');
}
