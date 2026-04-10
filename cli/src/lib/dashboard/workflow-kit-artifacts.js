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

import { join } from 'path';
import { loadConfig, loadProjectContext, loadProjectState } from '../config.js';
import { deriveWorkflowKitArtifacts } from '../workflow-kit-artifacts.js';
import { readJsonFile } from './state-reader.js';

/**
 * Read workflow-kit artifact status for the current phase.
 *
 * @param {string} workspacePath — project root (parent of .agentxchain/)
 * @returns {{ ok: boolean, status: number, body: object }}
 */
export function readWorkflowKitArtifacts(workspacePath) {
  const context = loadProjectContext(workspacePath);
  const governedContext = context?.config?.protocol_mode === 'governed' ? context : null;
  const legacyConfigResult = governedContext ? null : loadConfig(workspacePath);
  if (!governedContext && !legacyConfigResult) {
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

  const root = governedContext?.root || legacyConfigResult.root;
  const config = governedContext?.config || legacyConfigResult.config;
  const state = governedContext
    ? loadProjectState(root, config)
    : readJsonFile(join(root, '.agentxchain'), 'state.json');
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

  const snapshot = deriveWorkflowKitArtifacts(root, config, state);
  if (!snapshot) {
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

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      phase,
      artifacts: snapshot.artifacts,
    },
  };
}
