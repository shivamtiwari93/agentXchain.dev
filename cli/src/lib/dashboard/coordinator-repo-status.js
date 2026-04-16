import { loadCoordinatorConfig } from '../coordinator-config.js';
import { buildCoordinatorRepoStatusRows } from '../coordinator-repo-status-presentation.js';
import { loadCoordinatorState } from '../coordinator-state.js';

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

export function readCoordinatorRepoStatusRows(workspacePath) {
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

  return {
    ok: true,
    status: 200,
    body: buildCoordinatorRepoStatusRows({
      config: configResult.config,
      coordinatorRepoRuns: state.repo_runs || {},
    }),
  };
}
