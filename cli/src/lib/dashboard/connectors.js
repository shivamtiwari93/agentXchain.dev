import { loadProjectContext } from '../config.js';
import { readJsonFile } from './state-reader.js';
import { getConnectorHealth } from '../connector-health.js';
import { join } from 'path';

export function readConnectorHealthSnapshot(workspacePath) {
  const context = loadProjectContext(workspacePath);
  if (!context || context.config.protocol_mode !== 'governed') {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        code: 'config_missing',
        error: 'Project config not found. Run `agentxchain init --governed` first.',
      },
    };
  }

  const state = readJsonFile(join(workspacePath, '.agentxchain'), 'state.json');
  if (!state) {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        code: 'state_missing',
        error: 'Run state not found. Run `agentxchain init --governed` first.',
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      ...getConnectorHealth(workspacePath, context.config, state),
    },
  };
}
