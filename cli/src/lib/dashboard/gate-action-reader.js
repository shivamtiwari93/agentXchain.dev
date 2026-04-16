/**
 * Gate-action reader — reads gate-action config and latest attempt for the dashboard.
 *
 * Follows the same pattern as other dashboard readers (connectors.js, timeout-status.js):
 * returns { status, body } for the bridge server to serialize.
 *
 * Per DEC-DASHBOARD-GATE-ACTIONS-001: repo-local only, read-only.
 */

import { loadProjectContext, loadProjectState } from '../config.js';
import { getGateActions, summarizeLatestGateActionAttempt } from '../gate-actions.js';

/**
 * Read gate-action snapshot for the current pending gate (if any).
 *
 * @param {string} workspacePath — project root
 * @returns {{ status: number, body: object }}
 */
export function readGateActionSnapshot(workspacePath) {
  const context = loadProjectContext(workspacePath);
  if (!context || context.config?.protocol_mode !== 'governed') {
    return { status: 200, body: { configured: [], latest_attempt: null } };
  }

  const state = loadProjectState(context.root, context.config);
  if (!state) {
    return { status: 200, body: { configured: [], latest_attempt: null } };
  }

  const pendingTransition = state.pending_phase_transition || null;
  const pendingCompletion = state.pending_run_completion || null;

  let gateType = null;
  let gateId = null;

  if (pendingTransition?.gate) {
    gateType = 'phase_transition';
    gateId = pendingTransition.gate;
  } else if (pendingCompletion?.gate) {
    gateType = 'run_completion';
    gateId = pendingCompletion.gate;
  }

  if (!gateId) {
    return { status: 200, body: { configured: [], latest_attempt: null } };
  }

  const configured = getGateActions(context.config, gateId);
  const latestAttempt = summarizeLatestGateActionAttempt(context.root, gateType, gateId);

  return {
    status: 200,
    body: {
      configured,
      latest_attempt: latestAttempt,
    },
  };
}
