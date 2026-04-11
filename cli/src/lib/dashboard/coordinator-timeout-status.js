import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../config.js';
import { loadCoordinatorConfig } from '../coordinator-config.js';
import { loadCoordinatorState } from '../coordinator-state.js';
import { evaluateTimeouts } from '../timeout-evaluator.js';
import { readJsonlFile } from './state-reader.js';
import { buildTimeoutConfigSummary, extractTimeoutEvents } from './timeout-status.js';

function getCoordinatorConfigErrorResponse(errors) {
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

function emptyLiveTimeouts() {
  return { exceeded: [], warnings: [] };
}

function readRepoTimeoutSnapshot(repoId, repo, repoRun) {
  const context = loadProjectContext(repo.resolved_path);
  if (!context) {
    return {
      repo_id: repoId,
      path: repo.path,
      run_id: repoRun?.run_id ?? null,
      status: repoRun?.status ?? null,
      phase: repoRun?.phase ?? null,
      configured: false,
      config: null,
      live: null,
      events: [],
      error: {
        code: 'repo_config_missing',
        error: `Repo "${repoId}" config could not be loaded.`,
      },
    };
  }

  const state = loadProjectState(context.root, context.config);
  const agentxchainDir = join(context.root, '.agentxchain');
  const events = extractTimeoutEvents(readJsonlFile(agentxchainDir, 'decision-ledger.jsonl'));
  const configured = Boolean(context.config.timeouts);

  if (!state) {
    return {
      repo_id: repoId,
      path: repo.path,
      run_id: repoRun?.run_id ?? null,
      status: repoRun?.status ?? null,
      phase: repoRun?.phase ?? null,
      configured,
      config: buildTimeoutConfigSummary(context.config.timeouts, context.config.routing),
      live: configured ? emptyLiveTimeouts() : null,
      events,
      error: {
        code: 'repo_state_missing',
        error: `Repo "${repoId}" governed state is missing.`,
      },
    };
  }

  const live = configured && state.status === 'active'
    ? evaluateTimeouts({ config: context.config, state, now: new Date() })
    : (configured ? emptyLiveTimeouts() : null);

  return {
    repo_id: repoId,
    path: repo.path,
    run_id: state.run_id ?? repoRun?.run_id ?? null,
    status: state.status ?? repoRun?.status ?? null,
    phase: state.phase ?? repoRun?.phase ?? null,
    configured,
    config: buildTimeoutConfigSummary(context.config.timeouts, context.config.routing),
    live,
    events,
    error: null,
  };
}

export function readCoordinatorTimeoutStatus(workspacePath) {
  const configResult = loadCoordinatorConfig(workspacePath);
  if (!configResult.ok) {
    return getCoordinatorConfigErrorResponse(configResult.errors);
  }

  const coordinatorState = loadCoordinatorState(workspacePath);
  if (!coordinatorState) {
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

  const coordinatorDir = join(workspacePath, '.agentxchain', 'multirepo');
  const coordinatorEvents = extractTimeoutEvents(readJsonlFile(coordinatorDir, 'decision-ledger.jsonl'));
  const repos = configResult.config.repo_order.map((repoId) => (
    readRepoTimeoutSnapshot(repoId, configResult.config.repos[repoId], coordinatorState.repo_runs?.[repoId] ?? null)
  ));

  const summary = {
    repo_count: repos.length,
    configured_repo_count: repos.filter((repo) => repo.configured).length,
    repos_with_live_exceeded: repos.filter((repo) => (repo.live?.exceeded?.length || 0) > 0).length,
    repos_with_live_warnings: repos.filter((repo) => (repo.live?.warnings?.length || 0) > 0).length,
    repo_event_count: repos.reduce((sum, repo) => sum + repo.events.length, 0),
    coordinator_event_count: coordinatorEvents.length,
  };

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      super_run_id: coordinatorState.super_run_id ?? null,
      status: coordinatorState.status ?? null,
      phase: coordinatorState.phase ?? null,
      blocked_reason: coordinatorState.blocked_reason ?? null,
      summary,
      coordinator_events: coordinatorEvents,
      repos,
    },
  };
}
