import { appendFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectContext, loadProjectState } from './config.js';
import { assignGovernedTurn, getActiveTurnCount, initializeGovernedRun } from './governed-state.js';
import { writeDispatchBundle } from './dispatch-bundle.js';
import { getDispatchTurnDir } from './turn-paths.js';
import { readBarriers, readCoordinatorHistory, recordCoordinatorDecision } from './coordinator-state.js';
import { generateCrossRepoContext } from './cross-repo-context.js';

function loadRepoRuntime(repoPath) {
  const context = loadProjectContext(repoPath);
  if (!context) {
    return { ok: false, reason: 'repo_context_invalid', detail: `Repo at "${repoPath}" is not a loadable governed project` };
  }

  const state = loadProjectState(context.root, context.config);
  if (!state) {
    return { ok: false, reason: 'repo_state_missing', detail: `Repo at "${repoPath}" has no governed state` };
  }

  return {
    ok: true,
    root: context.root,
    config: context.config,
    state,
  };
}

function getWorkstreamCandidates(state, config) {
  const ordered = Array.isArray(config.workstream_order) ? [...config.workstream_order] : Object.keys(config.workstreams || {});
  const currentPhase = state.phase;
  const phaseCandidates = ordered.filter((workstreamId) => config.workstreams?.[workstreamId]?.phase === currentPhase);
  const entryWorkstream = config.routing?.[currentPhase]?.entry_workstream;

  if (!entryWorkstream || !phaseCandidates.includes(entryWorkstream)) {
    return phaseCandidates;
  }

  return [entryWorkstream, ...phaseCandidates.filter((workstreamId) => workstreamId !== entryWorkstream)];
}

function getAcceptedRepoIds(history, workstreamId) {
  return new Set(
    history
      .filter((entry) => entry?.type === 'acceptance_projection' && entry.workstream_id === workstreamId)
      .map((entry) => entry.repo_id),
  );
}

function barrierBlocksRepo(barrier, repoId, roleId) {
  if (!barrier || barrier.status === 'satisfied') {
    return false;
  }

  if (Array.isArray(barrier.blocked_assignments)) {
    for (const assignment of barrier.blocked_assignments) {
      if (assignment === repoId || assignment === `${repoId}:${roleId}` || assignment === `${repoId}:*`) {
        return true;
      }
    }
  }

  if (Array.isArray(barrier.downstream_repos) && barrier.downstream_repos.includes(repoId)) {
    return true;
  }

  if (barrier.type === 'shared_human_gate' && Array.isArray(barrier.required_repos) && barrier.required_repos.includes(repoId)) {
    return true;
  }

  return false;
}

function getDependencyBarrierId(workstreamId) {
  return `${workstreamId}_completion`;
}

function resolveRecommendedRole(repoState, repoConfig, workstreamPhase) {
  const routing = repoConfig.routing?.[workstreamPhase];
  if (repoState.charter_materialization_pending && workstreamPhase === 'planning') {
    if (repoConfig.roles?.pm) {
      return 'pm';
    }
    if (routing?.entry_role && repoConfig.roles?.[routing.entry_role]) {
      return routing.entry_role;
    }
  }

  const recommendedRole = repoState.next_recommended_role;
  if (
    recommendedRole
    && repoConfig.roles?.[recommendedRole]
    && (!routing?.allowed_next_roles || routing.allowed_next_roles.includes(recommendedRole))
  ) {
    return recommendedRole;
  }

  if (routing?.entry_role) {
    return routing.entry_role;
  }

  return Object.keys(repoConfig.roles || {})[0] || null;
}

function evaluateWorkstream(workspacePath, state, config, workstreamId, history, barriers) {
  const workstream = config.workstreams?.[workstreamId];
  if (!workstream) {
    return { ok: false, reason: 'workstream_missing', detail: `Unknown workstream "${workstreamId}"` };
  }

  for (const dependencyId of workstream.depends_on || []) {
    const dependencyBarrier = barriers[getDependencyBarrierId(dependencyId)];
    if (!dependencyBarrier || dependencyBarrier.status !== 'satisfied') {
      return {
        ok: false,
        reason: 'dependency_pending',
        detail: `Dependency "${dependencyId}" is not satisfied`,
        workstream_id: workstreamId,
      };
    }
  }

  const acceptedRepoIds = getAcceptedRepoIds(history, workstreamId);
  const candidateRepos = acceptedRepoIds.size === 0
    ? [workstream.entry_repo]
    : workstream.repos.filter((repoId) => !acceptedRepoIds.has(repoId));

  if (candidateRepos.length === 0) {
    return {
      ok: false,
      reason: 'workstream_complete',
      detail: `Workstream "${workstreamId}" already has accepted projections for all repos`,
      workstream_id: workstreamId,
    };
  }

  const repoId = candidateRepos[0];
  const repo = config.repos?.[repoId];
  const runtime = loadRepoRuntime(repo.resolved_path);
  if (!runtime.ok) {
    return { ok: false, reason: runtime.reason, detail: runtime.detail, workstream_id: workstreamId, repo_id: repoId };
  }

  if (runtime.state.status === 'blocked') {
    return {
      ok: false,
      reason: 'repo_blocked',
      detail: `Repo "${repoId}" is blocked`,
      workstream_id: workstreamId,
      repo_id: repoId,
    };
  }

  if (getActiveTurnCount(runtime.state) > 0) {
    return {
      ok: false,
      reason: 'repo_busy',
      detail: `Repo "${repoId}" already has an active turn`,
      workstream_id: workstreamId,
      repo_id: repoId,
    };
  }

  const role = resolveRecommendedRole(runtime.state, runtime.config, workstream.phase);
  if (!role) {
    return {
      ok: false,
      reason: 'role_unresolved',
      detail: `Repo "${repoId}" has no routing role for phase "${workstream.phase}"`,
      workstream_id: workstreamId,
      repo_id: repoId,
    };
  }

  for (const barrier of Object.values(barriers)) {
    if (barrier?.workstream_id !== workstreamId) {
      continue;
    }
    if (barrier.type === 'all_repos_accepted') {
      continue;
    }
    if (barrierBlocksRepo(barrier, repoId, role)) {
      return {
        ok: false,
        reason: 'barrier_blocked',
        detail: `Barrier "${barrier.barrier_id || 'unknown'}" blocks repo "${repoId}"`,
        workstream_id: workstreamId,
        repo_id: repoId,
      };
    }
  }

  return {
    ok: true,
    workstream_id: workstreamId,
    repo_id: repoId,
    role,
    reason: acceptedRepoIds.size === 0 ? 'entry_repo' : 'next_unaccepted_repo',
  };
}

function appendCoordinatorHistory(workspacePath, entry) {
  appendFileSync(join(workspacePath, '.agentxchain/multirepo/history.jsonl'), JSON.stringify(entry) + '\n');
}

export function selectNextAssignment(workspacePath, state, config) {
  const history = readCoordinatorHistory(workspacePath);
  const barriers = readBarriers(workspacePath);
  const candidates = getWorkstreamCandidates(state, config);
  let firstFailure = null;

  for (const workstreamId of candidates) {
    const evaluation = evaluateWorkstream(workspacePath, state, config, workstreamId, history, barriers);
    if (evaluation.ok) {
      return evaluation;
    }
    if (!firstFailure) {
      firstFailure = evaluation;
    }
  }

  return firstFailure || { ok: false, reason: 'no_assignable_workstream', detail: 'No workstream is assignable in the current phase' };
}

export function selectAssignmentForWorkstream(workspacePath, state, config, workstreamId) {
  const workstream = config.workstreams?.[workstreamId];
  if (!workstream) {
    return {
      ok: false,
      reason: 'workstream_missing',
      detail: `Unknown workstream "${workstreamId}"`,
      workstream_id: workstreamId,
    };
  }

  if (workstream.phase !== state.phase) {
    return {
      ok: false,
      reason: 'phase_mismatch',
      detail: `Workstream "${workstreamId}" is in phase "${workstream.phase}", but coordinator is currently in phase "${state.phase}"`,
      workstream_id: workstreamId,
    };
  }

  const history = readCoordinatorHistory(workspacePath);
  const barriers = readBarriers(workspacePath);
  return evaluateWorkstream(workspacePath, state, config, workstreamId, history, barriers);
}

export function dispatchCoordinatorTurn(workspacePath, state, config, assignment) {
  if (!assignment?.ok) {
    return { ok: false, error: 'Assignment is required before dispatch' };
  }

  const repo = config.repos?.[assignment.repo_id];
  if (!repo) {
    return { ok: false, error: `Unknown repo "${assignment.repo_id}"` };
  }

  const runtime = loadRepoRuntime(repo.resolved_path);
  if (!runtime.ok) {
    return { ok: false, error: runtime.detail };
  }

  let repoState = runtime.state;
  if (repoState.status === 'idle' || repoState.status === 'completed') {
    const initResult = initializeGovernedRun(runtime.root, runtime.config, {
      allow_terminal_restart: repoState.status === 'completed',
    });
    if (!initResult.ok) {
      return { ok: false, error: initResult.error };
    }
    repoState = initResult.state;
  }

  const assignResult = assignGovernedTurn(runtime.root, runtime.config, assignment.role);
  if (!assignResult.ok) {
    return { ok: false, error: assignResult.error };
  }

  const bundleResult = writeDispatchBundle(runtime.root, assignResult.state, runtime.config);
  if (!bundleResult.ok) {
    return { ok: false, error: bundleResult.error };
  }

  const turn = assignResult.turn;
  const contextResult = generateCrossRepoContext(
    workspacePath,
    state,
    config,
    assignment.repo_id,
    assignment.workstream_id,
  );
  if (!contextResult.ok) {
    return { ok: false, error: contextResult.error };
  }

  const bundleDir = join(runtime.root, getDispatchTurnDir(turn.turn_id));
  copyFileSync(contextResult.jsonPath, join(bundleDir, 'COORDINATOR_CONTEXT.json'));
  copyFileSync(contextResult.mdPath, join(bundleDir, 'COORDINATOR_CONTEXT.md'));

  appendCoordinatorHistory(workspacePath, {
    type: 'turn_dispatched',
    timestamp: new Date().toISOString(),
    super_run_id: state.super_run_id,
    workstream_id: assignment.workstream_id,
    repo_id: assignment.repo_id,
    repo_run_id: runtime.state.run_id,
    repo_turn_id: turn.turn_id,
    role: assignment.role,
    context_ref: contextResult.contextRef,
  });
  recordCoordinatorDecision(workspacePath, state, {
    category: 'dispatch',
    statement: `Dispatched ${assignment.repo_id} to ${assignment.role} for workstream ${assignment.workstream_id}`,
    repo_id: assignment.repo_id,
    repo_run_id: runtime.state.run_id,
    repo_turn_id: turn.turn_id,
    workstream_id: assignment.workstream_id,
    context_ref: contextResult.contextRef,
  });

  return {
    ok: true,
    repo_id: assignment.repo_id,
    turn_id: turn.turn_id,
    bundle_path: bundleResult.bundlePath,
    context_ref: contextResult.contextRef,
  };
}
