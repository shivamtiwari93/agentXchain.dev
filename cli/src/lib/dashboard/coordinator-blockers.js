import { evaluateCompletionGate, evaluatePhaseGate } from '../coordinator-gates.js';
import { loadCoordinatorConfig } from '../coordinator-config.js';
import { loadCoordinatorState } from '../coordinator-state.js';

function normalizePendingGate(pendingGate) {
  if (!pendingGate || typeof pendingGate !== 'object' || Array.isArray(pendingGate)) {
    return null;
  }

  if (typeof pendingGate.gate !== 'string' || pendingGate.gate.length === 0) {
    return null;
  }

  if (typeof pendingGate.gate_type !== 'string' || pendingGate.gate_type.length === 0) {
    return null;
  }

  const normalized = {
    gate: pendingGate.gate,
    gate_type: pendingGate.gate_type,
  };

  if (typeof pendingGate.from === 'string' && pendingGate.from.length > 0) {
    normalized.from = pendingGate.from;
  }

  if (typeof pendingGate.to === 'string' && pendingGate.to.length > 0) {
    normalized.to = pendingGate.to;
  }

  if (Array.isArray(pendingGate.required_repos)) {
    normalized.required_repos = pendingGate.required_repos;
  }

  if (Array.isArray(pendingGate.human_barriers)) {
    normalized.human_barriers = pendingGate.human_barriers;
  }

  if (typeof pendingGate.requested_at === 'string' && pendingGate.requested_at.length > 0) {
    normalized.requested_at = pendingGate.requested_at;
  }

  return normalized;
}

function normalizePhaseEvaluation(evaluation) {
  return {
    ready: Boolean(evaluation?.ready),
    gate_id: evaluation?.gate_id ?? null,
    current_phase: evaluation?.current_phase ?? null,
    target_phase: evaluation?.target_phase ?? null,
    required_repos: Array.isArray(evaluation?.required_repos) ? evaluation.required_repos : [],
    workstreams: Array.isArray(evaluation?.workstreams) ? evaluation.workstreams : [],
    human_barriers: Array.isArray(evaluation?.human_barriers) ? evaluation.human_barriers : [],
    blockers: Array.isArray(evaluation?.blockers) ? evaluation.blockers : [],
  };
}

function normalizeCompletionEvaluation(evaluation) {
  return {
    ready: Boolean(evaluation?.ready),
    gate_id: evaluation?.gate_id ?? null,
    required_repos: Array.isArray(evaluation?.required_repos) ? evaluation.required_repos : [],
    human_barriers: Array.isArray(evaluation?.human_barriers) ? evaluation.human_barriers : [],
    requires_human_approval: evaluation?.requires_human_approval !== false,
    blockers: Array.isArray(evaluation?.blockers) ? evaluation.blockers : [],
  };
}

function buildPendingGateSnapshot(pendingGate) {
  return {
    gate_type: pendingGate.gate_type,
    gate_id: pendingGate.gate,
    ready: true,
    current_phase: pendingGate.from ?? null,
    target_phase: pendingGate.to ?? null,
    required_repos: Array.isArray(pendingGate.required_repos) ? pendingGate.required_repos : [],
    human_barriers: Array.isArray(pendingGate.human_barriers) ? pendingGate.human_barriers : [],
    blockers: [],
    pending: true,
  };
}

function phaseIsFinal(phaseEvaluation) {
  return phaseEvaluation.blockers.length === 1
    && phaseEvaluation.blockers[0]?.code === 'no_next_phase';
}

function getConfigErrorResponse(errors) {
  const issueList = Array.isArray(errors) ? errors : [];
  const missing = issueList.some((error) => typeof error === 'string' && error.startsWith('config_missing:'));

  return {
    ok: false,
    status: missing ? 404 : 422,
    body: {
      ok: false,
      code: missing ? 'coordinator_config_missing' : 'coordinator_config_invalid',
      error: missing
        ? 'Coordinator config not found. Run `agentxchain multi init` first.'
        : 'Coordinator config is invalid.',
      errors: issueList,
    },
  };
}

export function readCoordinatorBlockerSnapshot(workspacePath) {
  const configResult = loadCoordinatorConfig(workspacePath);
  if (!configResult.ok) {
    return getConfigErrorResponse(configResult.errors);
  }

  const state = loadCoordinatorState(workspacePath);
  if (!state) {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        code: 'coordinator_state_missing',
        error: 'Coordinator state not found. Run `agentxchain multi init` first.',
      },
    };
  }

  const phaseEvaluation = normalizePhaseEvaluation(
    evaluatePhaseGate(workspacePath, state, configResult.config),
  );
  const completionEvaluation = normalizeCompletionEvaluation(
    evaluateCompletionGate(workspacePath, state, configResult.config),
  );
  const pendingGate = normalizePendingGate(state.pending_gate);

  let mode = 'phase_transition';
  let active = {
    gate_type: 'phase_transition',
    ...phaseEvaluation,
  };

  if (pendingGate) {
    mode = 'pending_gate';
    active = buildPendingGateSnapshot(pendingGate);
  } else if (phaseIsFinal(phaseEvaluation)) {
    mode = 'run_completion';
    active = {
      gate_type: 'run_completion',
      ...completionEvaluation,
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      mode,
      super_run_id: state.super_run_id ?? null,
      status: state.status ?? null,
      phase: state.phase ?? null,
      blocked_reason: state.blocked_reason ?? null,
      pending_gate: pendingGate,
      active,
      evaluations: {
        phase_transition: phaseEvaluation,
        run_completion: completionEvaluation,
      },
    },
  };
}
