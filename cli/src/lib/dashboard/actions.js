import { dirname } from 'path';
import { loadProjectContext } from '../config.js';
import { approvePhaseTransition, approveRunCompletion } from '../governed-state.js';
import { deriveRecoveryDescriptor } from '../blocked-state.js';
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
  if (gateType === 'phase_transition') {
    return {
      status: 200,
      body: {
        ok: true,
        scope: 'repo',
        gate_type: 'phase_transition',
        message: `Phase transition approved: ${result.transition.from} -> ${result.transition.to}`,
        next_action: 'agentxchain step',
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      scope: 'repo',
      gate_type: 'run_completion',
      message: 'Run completion approved. Run is now completed.',
      next_action: null,
    },
  };
}

function normalizeRepoFailure(result) {
  const recovery = result.state ? deriveRecoveryDescriptor(result.state) : null;
  const code = result.error_code || 'approval_failed';
  return buildError(409, code, result.error || 'Gate approval failed', {
    next_action: recovery?.recovery_action || null,
  });
}

function approveRepoGate(root, config, state) {
  const gateType = state.pending_phase_transition ? 'phase_transition' : 'run_completion';
  const result = gateType === 'phase_transition'
    ? approvePhaseTransition(root, config)
    : approveRunCompletion(root, config);

  if (!result.ok) {
    return normalizeRepoFailure(result);
  }

  return normalizeRepoSuccess(result, gateType);
}

function normalizeCoordinatorSuccess(result, gateType) {
  if (gateType === 'phase_transition') {
    return {
      status: 200,
      body: {
        ok: true,
        scope: 'coordinator',
        gate_type: 'phase_transition',
        message: `Coordinator phase transition approved: ${result.transition.from} -> ${result.transition.to}`,
        next_action: 'agentxchain multi step',
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      scope: 'coordinator',
      gate_type: 'run_completion',
      message: 'Coordinator run completion approved. Run is now complete.',
      next_action: null,
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
    return buildError(409, 'hook_blocked', reason);
  }

  if (!gateHook.ok) {
    return buildError(409, 'hook_failed', gateHook.error || 'before_gate hook failed');
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
    return buildError(409, 'approval_failed', result.error || 'Coordinator gate approval failed');
  }

  return normalizeCoordinatorSuccess(result, gateType);
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
