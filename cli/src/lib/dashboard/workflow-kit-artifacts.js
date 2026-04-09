/**
 * Workflow-kit artifact status — computed dashboard endpoint.
 *
 * Reads agentxchain.json config and .agentxchain/state.json to derive
 * current-phase workflow-kit artifact status for live dashboard observation.
 *
 * Per DEC-WK-REPORT-002: ownership resolution uses explicit owned_by first,
 * then falls back to routing[phase].entry_role.
 *
 * See: WORKFLOW_KIT_DASHBOARD_SPEC.md
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../config.js';
import { readJsonFile } from './state-reader.js';

/**
 * Read workflow-kit artifact status for the current phase.
 *
 * @param {string} workspacePath — project root (parent of .agentxchain/)
 * @returns {{ ok: boolean, status: number, body: object }}
 */
export function readWorkflowKitArtifacts(workspacePath) {
  const configResult = loadConfig(workspacePath);
  if (!configResult) {
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

  const agentxchainDir = join(workspacePath, '.agentxchain');
  const state = readJsonFile(agentxchainDir, 'state.json');
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

  const config = configResult.config;
  const phase = state.phase || null;

  if (!config.workflow_kit) {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        phase,
        artifacts: null,
      },
    };
  }

  if (!phase) {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        phase: null,
        artifacts: [],
      },
    };
  }

  const phaseConfig = config.workflow_kit.phases?.[phase];
  if (!phaseConfig) {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        phase,
        artifacts: [],
      },
    };
  }

  const artifacts = Array.isArray(phaseConfig.artifacts) ? phaseConfig.artifacts : [];
  if (artifacts.length === 0) {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        phase,
        artifacts: [],
      },
    };
  }

  const entryRole = config.routing?.[phase]?.entry_role || null;

  const result = artifacts
    .filter((a) => a && typeof a.path === 'string')
    .map((a) => {
      const hasExplicitOwner = typeof a.owned_by === 'string' && a.owned_by.length > 0;
      return {
        path: a.path,
        required: a.required !== false,
        semantics: a.semantics || null,
        owned_by: hasExplicitOwner ? a.owned_by : entryRole,
        owner_resolution: hasExplicitOwner ? 'explicit' : 'entry_role',
        exists: existsSync(join(workspacePath, a.path)),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      phase,
      artifacts: result,
    },
  };
}
