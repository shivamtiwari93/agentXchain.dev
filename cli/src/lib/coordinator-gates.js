import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBarriers, saveCoordinatorState } from './coordinator-state.js';
import { recordBarrierTransition } from './coordinator-acceptance.js';
import { safeWriteJson } from './safe-write.js';

function appendCoordinatorHistory(workspacePath, entry) {
  appendFileSync(join(workspacePath, '.agentxchain/multirepo/history.jsonl'), JSON.stringify(entry) + '\n');
}

function loadRepoState(repoPath) {
  const filePath = join(repoPath, '.agentxchain/state.json');
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getActiveTurnCount(repoState) {
  if (!repoState?.active_turns || typeof repoState.active_turns !== 'object' || Array.isArray(repoState.active_turns)) {
    return 0;
  }

  return Object.keys(repoState.active_turns).length;
}

function getPhaseOrder(config) {
  const routingPhases = Object.keys(config.routing || {});
  if (routingPhases.length > 0) {
    return routingPhases;
  }

  const phases = [];
  for (const workstreamId of config.workstream_order || []) {
    const phase = config.workstreams?.[workstreamId]?.phase;
    if (phase && !phases.includes(phase)) {
      phases.push(phase);
    }
  }
  return phases;
}

function getNextPhase(currentPhase, config) {
  const phases = getPhaseOrder(config);
  const currentIndex = phases.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex === phases.length - 1) {
    return null;
  }
  return phases[currentIndex + 1];
}

function getRequiredReposForPhase(state, config) {
  const required = new Set();
  for (const workstreamId of config.workstream_order || []) {
    const workstream = config.workstreams?.[workstreamId];
    if (workstream?.phase !== state.phase) {
      continue;
    }
    for (const repoId of workstream.repos || []) {
      required.add(repoId);
    }
  }
  return [...required];
}

function buildRepoBlockers(config, repoIds) {
  const blockers = [];

  for (const repoId of repoIds) {
    const repo = config.repos?.[repoId];
    const repoState = repo?.resolved_path ? loadRepoState(repo.resolved_path) : null;

    if (!repoState) {
      blockers.push({
        code: 'repo_state_missing',
        repo_id: repoId,
        message: `Repo "${repoId}" is missing .agentxchain/state.json`,
      });
      continue;
    }

    if (repoState.status === 'blocked') {
      blockers.push({
        code: 'repo_blocked',
        repo_id: repoId,
        message: `Repo "${repoId}" is blocked`,
      });
    }

    const activeTurnCount = getActiveTurnCount(repoState);
    if (activeTurnCount > 0) {
      blockers.push({
        code: 'repo_active_turns',
        repo_id: repoId,
        active_turns: activeTurnCount,
        message: `Repo "${repoId}" still has ${activeTurnCount} active turn(s)`,
      });
    }

    if (repoState.pending_phase_transition || repoState.pending_run_completion) {
      blockers.push({
        code: 'repo_pending_gate',
        repo_id: repoId,
        message: `Repo "${repoId}" still has a pending repo-local gate`,
      });
    }
  }

  return blockers;
}

function buildPhaseBarrierState(state, config, barriers) {
  const workstreams = [];
  const blockers = [];
  const humanBarriers = [];

  for (const workstreamId of config.workstream_order || []) {
    const workstream = config.workstreams?.[workstreamId];
    if (workstream?.phase !== state.phase) {
      continue;
    }

    const barrierId = `${workstreamId}_completion`;
    const barrier = barriers[barrierId];
    if (!barrier) {
      blockers.push({
        code: 'barrier_missing',
        barrier_id: barrierId,
        workstream_id: workstreamId,
        message: `Barrier "${barrierId}" is missing`,
      });
      continue;
    }

    workstreams.push({
      workstream_id: workstreamId,
      barrier_id: barrierId,
      barrier_type: barrier.type,
      barrier_status: barrier.status,
    });

    if (barrier.status === 'satisfied') {
      continue;
    }

    if (barrier.type === 'shared_human_gate') {
      humanBarriers.push(barrierId);
      continue;
    }

    blockers.push({
      code: 'barrier_unsatisfied',
      barrier_id: barrierId,
      workstream_id: workstreamId,
      barrier_status: barrier.status,
      message: `Barrier "${barrierId}" is "${barrier.status}"`,
    });
  }

  return { workstreams, blockers, humanBarriers };
}

function applyHumanBarrierApprovals(workspacePath, state, barrierIds, gate) {
  if (!Array.isArray(barrierIds) || barrierIds.length === 0) {
    return;
  }

  const barriers = readBarriers(workspacePath);
  let changed = false;

  for (const barrierId of barrierIds) {
    const barrier = barriers[barrierId];
    if (!barrier || barrier.status === 'satisfied') {
      continue;
    }

    const previousStatus = barrier.status;
    barrier.status = 'satisfied';
    barrier.approved_at = new Date().toISOString();
    changed = true;

    recordBarrierTransition(workspacePath, barrierId, previousStatus, 'satisfied', {
      super_run_id: state.super_run_id,
      gate_type: gate.gate_type,
      gate: gate.gate,
      approved_by: 'human',
    });
  }

  if (changed) {
    safeWriteJson(join(workspacePath, '.agentxchain/multirepo/barriers.json'), barriers);
  }
}

function getInitiativeGate(config) {
  if (config.gates?.initiative_ship) {
    return {
      gate_id: 'initiative_ship',
      ...config.gates.initiative_ship,
    };
  }

  return {
    gate_id: 'initiative_ship',
    requires_human_approval: true,
    requires_repos: config.repo_order.filter((repoId) => config.repos?.[repoId]?.required !== false),
  };
}

function repoIsCompletionReady(repoState) {
  return repoState?.status === 'completed' || Boolean(repoState?.pending_run_completion);
}

export function evaluatePhaseGate(workspacePath, state, config, targetPhase) {
  const nextPhase = getNextPhase(state.phase, config);
  const resolvedTargetPhase = targetPhase ?? nextPhase;
  const blockers = [];

  if (!nextPhase) {
    blockers.push({
      code: 'no_next_phase',
      message: `Current phase "${state.phase}" is already final`,
    });
  } else if (resolvedTargetPhase !== nextPhase) {
    blockers.push({
      code: 'phase_skip_forbidden',
      message: `Requested phase "${resolvedTargetPhase}" is invalid; next phase is "${nextPhase}"`,
    });
  }

  const repoIds = getRequiredReposForPhase(state, config);
  blockers.push(...buildRepoBlockers(config, repoIds));

  const barriers = readBarriers(workspacePath);
  const barrierState = buildPhaseBarrierState(state, config, barriers);
  blockers.push(...barrierState.blockers);

  return {
    ready: blockers.length === 0,
    current_phase: state.phase,
    target_phase: resolvedTargetPhase,
    gate_id: resolvedTargetPhase ? `phase_transition:${state.phase}->${resolvedTargetPhase}` : null,
    required_repos: repoIds,
    workstreams: barrierState.workstreams,
    blockers,
    human_barriers: barrierState.humanBarriers,
  };
}

export function requestPhaseTransition(workspacePath, state, config, targetPhase) {
  if (state.status !== 'active') {
    return { ok: false, error: `Cannot request phase transition: status is "${state.status}", expected "active"` };
  }
  if (state.pending_gate) {
    return { ok: false, error: `Cannot request phase transition: pending gate "${state.pending_gate.gate}" already exists` };
  }

  const evaluation = evaluatePhaseGate(workspacePath, state, config, targetPhase);
  if (!evaluation.ready) {
    return { ok: false, error: 'Phase gate is not ready', evaluation };
  }

  const pendingGate = {
    gate_type: 'phase_transition',
    gate: evaluation.gate_id,
    from: state.phase,
    to: evaluation.target_phase,
    required_repos: evaluation.required_repos,
    human_barriers: evaluation.human_barriers,
    requested_at: new Date().toISOString(),
  };

  const updatedState = {
    ...state,
    status: 'paused',
    pending_gate: pendingGate,
  };
  saveCoordinatorState(workspacePath, updatedState);

  appendCoordinatorHistory(workspacePath, {
    type: 'phase_transition_requested',
    timestamp: pendingGate.requested_at,
    super_run_id: state.super_run_id,
    gate: pendingGate.gate,
    from: pendingGate.from,
    to: pendingGate.to,
    required_repos: pendingGate.required_repos,
    human_barriers: pendingGate.human_barriers,
  });

  return { ok: true, state: updatedState, gate: pendingGate, evaluation };
}

export function approveCoordinatorPhaseTransition(workspacePath, state, config) {
  const pendingGate = state.pending_gate;
  if (!pendingGate || pendingGate.gate_type !== 'phase_transition') {
    return { ok: false, error: 'No pending phase transition to approve' };
  }
  if (!['paused', 'blocked'].includes(state.status)) {
    return { ok: false, error: `Cannot approve phase transition: status is "${state.status}", expected "paused" or "blocked"` };
  }

  applyHumanBarrierApprovals(workspacePath, state, pendingGate.human_barriers, pendingGate);

  const updatedState = {
    ...state,
    phase: pendingGate.to,
    status: 'active',
    pending_gate: null,
    phase_gate_status: {
      ...(state.phase_gate_status || {}),
      [pendingGate.gate]: 'passed',
    },
  };
  saveCoordinatorState(workspacePath, updatedState);

  appendCoordinatorHistory(workspacePath, {
    type: 'phase_transition_approved',
    timestamp: new Date().toISOString(),
    super_run_id: state.super_run_id,
    gate: pendingGate.gate,
    from: pendingGate.from,
    to: pendingGate.to,
  });

  return { ok: true, state: updatedState, transition: pendingGate };
}

export function evaluateCompletionGate(workspacePath, state, config) {
  const initiativeGate = getInitiativeGate(config);
  const blockers = [];
  const phaseOrder = getPhaseOrder(config);

  if (phaseOrder.length > 0 && state.phase !== phaseOrder[phaseOrder.length - 1]) {
    blockers.push({
      code: 'not_final_phase',
      message: `Current phase "${state.phase}" is not final`,
    });
  }

  const barriers = readBarriers(workspacePath);
  const humanBarriers = [];
  for (const [barrierId, barrier] of Object.entries(barriers)) {
    if (barrier.status === 'satisfied') {
      continue;
    }

    if (barrier.type === 'shared_human_gate') {
      humanBarriers.push(barrierId);
      continue;
    }

    blockers.push({
      code: 'barrier_unsatisfied',
      barrier_id: barrierId,
      barrier_status: barrier.status,
      message: `Barrier "${barrierId}" is "${barrier.status}"`,
    });
  }

  for (const repoId of initiativeGate.requires_repos || []) {
    const repo = config.repos?.[repoId];
    const repoState = repo?.resolved_path ? loadRepoState(repo.resolved_path) : null;

    if (!repoState) {
      blockers.push({
        code: 'repo_state_missing',
        repo_id: repoId,
        message: `Repo "${repoId}" is missing .agentxchain/state.json`,
      });
      continue;
    }

    if (repoState.status === 'blocked') {
      blockers.push({
        code: 'repo_blocked',
        repo_id: repoId,
        message: `Repo "${repoId}" is blocked`,
      });
    }

    const activeTurnCount = getActiveTurnCount(repoState);
    if (activeTurnCount > 0) {
      blockers.push({
        code: 'repo_active_turns',
        repo_id: repoId,
        active_turns: activeTurnCount,
        message: `Repo "${repoId}" still has ${activeTurnCount} active turn(s)`,
      });
    }

    if (!repoIsCompletionReady(repoState)) {
      blockers.push({
        code: 'repo_not_completion_ready',
        repo_id: repoId,
        message: `Repo "${repoId}" is neither completed nor pending run completion approval`,
      });
    }
  }

  return {
    ready: blockers.length === 0,
    gate_id: initiativeGate.gate_id,
    blockers,
    required_repos: initiativeGate.requires_repos,
    human_barriers: humanBarriers,
    requires_human_approval: initiativeGate.requires_human_approval !== false,
  };
}

export function requestCoordinatorCompletion(workspacePath, state, config) {
  if (state.status !== 'active') {
    return { ok: false, error: `Cannot request initiative completion: status is "${state.status}", expected "active"` };
  }
  if (state.pending_gate) {
    return { ok: false, error: `Cannot request initiative completion: pending gate "${state.pending_gate.gate}" already exists` };
  }

  const evaluation = evaluateCompletionGate(workspacePath, state, config);
  if (!evaluation.ready) {
    return { ok: false, error: 'Completion gate is not ready', evaluation };
  }

  const pendingGate = {
    gate_type: 'run_completion',
    gate: evaluation.gate_id,
    required_repos: evaluation.required_repos,
    human_barriers: evaluation.human_barriers,
    requested_at: new Date().toISOString(),
  };

  const updatedState = {
    ...state,
    status: 'paused',
    pending_gate: pendingGate,
  };
  saveCoordinatorState(workspacePath, updatedState);

  appendCoordinatorHistory(workspacePath, {
    type: 'run_completion_requested',
    timestamp: pendingGate.requested_at,
    super_run_id: state.super_run_id,
    gate: pendingGate.gate,
    required_repos: pendingGate.required_repos,
    human_barriers: pendingGate.human_barriers,
  });

  return { ok: true, state: updatedState, gate: pendingGate, evaluation };
}

export function approveCoordinatorCompletion(workspacePath, state, config) {
  const pendingGate = state.pending_gate;
  if (!pendingGate || pendingGate.gate_type !== 'run_completion') {
    return { ok: false, error: 'No pending initiative completion to approve' };
  }
  if (!['paused', 'blocked'].includes(state.status)) {
    return { ok: false, error: `Cannot approve initiative completion: status is "${state.status}", expected "paused" or "blocked"` };
  }

  applyHumanBarrierApprovals(workspacePath, state, pendingGate.human_barriers, pendingGate);

  const updatedState = {
    ...state,
    status: 'completed',
    completed_at: new Date().toISOString(),
    pending_gate: null,
    phase_gate_status: {
      ...(state.phase_gate_status || {}),
      [pendingGate.gate]: 'passed',
    },
  };
  saveCoordinatorState(workspacePath, updatedState);

  appendCoordinatorHistory(workspacePath, {
    type: 'run_completed',
    timestamp: updatedState.completed_at,
    super_run_id: state.super_run_id,
    gate: pendingGate.gate,
  });

  return { ok: true, state: updatedState, completion: pendingGate };
}
