/**
 * Runner Interface — declared contract for governed execution consumers.
 *
 * This module re-exports the library functions that any runner (CLI, CI,
 * hosted, programmatic) needs to orchestrate governed turns. It is the
 * formal boundary described in RUNNER_INTERFACE_SPEC.md.
 *
 * Design rules:
 *   - Only protocol-normative operations are exported here
 *   - Adapter dispatch is NOT included (runner-specific)
 *   - CLI output formatting is NOT included (runner-specific)
 *   - Dashboard, export, report, intake are NOT included (runner features)
 *
 * Usage:
 *   import { loadContext, loadState, initRun, assignTurn, acceptTurn } from './runner-interface.js';
 *   const ctx = loadContext();
 *   const state = loadState(ctx.root, ctx.config);
 *   // ... orchestrate turns
 */

// ── Context ─────────────────────────────────────────────────────────────────

export { loadProjectContext as loadContext, loadProjectState as loadState } from './config.js';

// ── Governed Lifecycle ──────────────────────────────────────────────────────

export {
  initializeGovernedRun as initRun,
  assignGovernedTurn as assignTurn,
  acceptGovernedTurn as acceptTurn,
  rejectGovernedTurn as rejectTurn,
  approvePhaseTransition as approvePhaseGate,
  approveRunCompletion as approveCompletionGate,
  markRunBlocked,
  raiseOperatorEscalation as escalate,
  reactivateGovernedRun as reactivateRun,
  getActiveTurns,
  getActiveTurnCount,
  getActiveTurn,
  acquireAcceptanceLock as acquireLock,
  releaseAcceptanceLock as releaseLock,
  refreshTurnBaselineSnapshot,
  reissueTurn,
} from './governed-state.js';

// ── Dispatch ────────────────────────────────────────────────────────────────

export { writeDispatchBundle } from './dispatch-bundle.js';
export { getTurnStagingResultPath } from './turn-paths.js';

// ── Hooks & Notifications ───────────────────────────────────────────────────

export { runHooks } from './hook-runner.js';
export { emitNotifications } from './notification-runner.js';

// ── Config Utilities ────────────────────────────────────────────────────────

export { getMaxConcurrentTurns } from './normalized-config.js';

// ── Interface Version ───────────────────────────────────────────────────────

export const RUNNER_INTERFACE_VERSION = '0.2';
