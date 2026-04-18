/**
 * Session checkpoint — automatic state markers for cross-session restart.
 *
 * Writes .agentxchain/session.json at every governance boundary
 * (turn assignment, acceptance, phase transition, blocked state,
 * gate approval, run completion, restart/reconnect) so that
 * `agentxchain restart` can reconstruct dispatch context without
 * any in-memory session state.
 *
 * Design rules:
 *   - Checkpoint writes are non-fatal: failures log a warning and do not
 *     block the governance operation.
 *   - The file is always overwritten, not appended.
 *   - run_id in session.json must agree with state.json; mismatch is a
 *     corruption signal.
 *   - state.json is always authoritative; session.json is recovery metadata.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { execSync as shellExec } from 'child_process';

const SESSION_PATH = '.agentxchain/session.json';

/**
 * Generate a new session ID.
 */
function generateSessionId() {
  return `session_${randomBytes(8).toString('hex')}`;
}

/**
 * Capture git baseline ref for repo-drift detection.
 * Non-fatal: returns partial/null fields on failure.
 */
export function captureBaselineRef(root) {
  try {
    const gitHead = shellExec('git rev-parse HEAD', { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const gitBranch = shellExec('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const statusOutput = shellExec('git status --porcelain', { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return {
      git_head: gitHead,
      git_branch: gitBranch,
      workspace_dirty: statusOutput.length > 0,
    };
  } catch {
    return { git_head: null, git_branch: null, workspace_dirty: null };
  }
}

/**
 * Read the current session checkpoint, or null if none exists.
 */
export function readSessionCheckpoint(root) {
  const filePath = join(root, SESSION_PATH);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Extract active turn IDs from governed state.
 */
function getActiveTurnIds(state) {
  const turns = state.active_turns || {};
  return Object.keys(turns);
}

/**
 * Write or update the session checkpoint.
 *
 * @param {string} root - project root
 * @param {object} state - current governed state (from state.json)
 * @param {string} reason - checkpoint reason (e.g. 'turn_assigned', 'turn_accepted',
 *                          'phase_approved', 'run_completed', 'blocked', 'restart_reconnect')
 * @param {object} [extra] - optional extra context fields
 */
export function writeSessionCheckpoint(root, state, reason, extra = {}) {
  const filePath = join(root, SESSION_PATH);
  try {
    // Read existing session to preserve session_id across checkpoints in the same session
    const existing = readSessionCheckpoint(root);
    const sessionId = (existing && existing.run_id === state.run_id)
      ? existing.session_id
      : generateSessionId();

    const currentTurn = state.current_turn || null;
    const activeTurnIds = getActiveTurnIds(state);
    const lastTurnId = currentTurn?.id || currentTurn?.turn_id
      || (activeTurnIds.length > 0 ? activeTurnIds[activeTurnIds.length - 1] : null)
      || state.last_completed_turn_id || null;
    const lastRole = currentTurn?.role || currentTurn?.assigned_role || extra.role || null;
    const lastPhase = state.current_phase || state.phase || null;

    // Derive last_completed_turn_id from history or state
    const lastCompletedTurnId = state.last_completed_turn_id || existing?.last_completed_turn_id || null;

    // Derive pending gates
    const pendingGate = state.pending_phase_transition?.gate || state.pending_transition?.gate || null;
    const pendingRunCompletion = state.pending_run_completion?.gate || null;

    // Capture git baseline for repo-drift detection.
    // When a turn_baseline from captureBaseline() is provided, derive
    // baseline_ref from it so session.json and state.json always agree
    // on workspace-dirty status (BUG-2 fix).
    let baselineRef;
    if (extra.turn_baseline) {
      baselineRef = {
        git_head: extra.turn_baseline.head_ref || null,
        git_branch: null,
        workspace_dirty: !extra.turn_baseline.clean,
      };
      // Fill in git_branch if available
      try {
        baselineRef.git_branch = shellExec('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      } catch { /* non-fatal */ }
    } else {
      baselineRef = extra.baseline_ref || captureBaselineRef(root);
    }

    const checkpoint = {
      session_id: sessionId,
      run_id: state.run_id,
      started_at: existing?.started_at || new Date().toISOString(),
      last_checkpoint_at: new Date().toISOString(),
      checkpoint_reason: reason,
      run_status: state.status || null,
      phase: lastPhase,
      last_phase: lastPhase, // backward compat alias for report.js consumers
      last_turn_id: lastTurnId,
      last_completed_turn_id: lastCompletedTurnId,
      active_turn_ids: activeTurnIds,
      last_role: lastRole,
      pending_gate: pendingGate,
      pending_run_completion: pendingRunCompletion ? true : null,
      blocked: state.status === 'blocked',
      baseline_ref: baselineRef,
      agent_context: {
        adapter: extra.adapter || null,
        dispatch_dir: extra.dispatch_dir || null,
      },
    };

    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(checkpoint, null, 2) + '\n');
  } catch (err) {
    // Non-fatal — warn but do not block governance operations
    if (process.env.AGENTXCHAIN_DEBUG) {
      console.error(`[session-checkpoint] Warning: failed to write checkpoint: ${err.message}`);
    }
  }
}

export { SESSION_PATH };
