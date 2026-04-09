/**
 * Session checkpoint — automatic state markers for cross-session restart.
 *
 * Writes .agentxchain/session.json at every governance boundary
 * (turn acceptance, phase transition, gate approval, run completion)
 * so that `agentxchain restart` can reconstruct dispatch context
 * without any in-memory session state.
 *
 * Design rules:
 *   - Checkpoint writes are non-fatal: failures log a warning and do not
 *     block the governance operation.
 *   - The file is always overwritten, not appended.
 *   - run_id in session.json must agree with state.json; mismatch is a
 *     corruption signal.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

const SESSION_PATH = '.agentxchain/session.json';

/**
 * Generate a new session ID.
 */
function generateSessionId() {
  return `session_${randomBytes(8).toString('hex')}`;
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
 * Write or update the session checkpoint.
 *
 * @param {string} root - project root
 * @param {object} state - current governed state (from state.json)
 * @param {string} reason - checkpoint reason (e.g. 'turn_accepted', 'phase_approved', 'run_completed')
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

    const checkpoint = {
      session_id: sessionId,
      run_id: state.run_id,
      started_at: existing?.started_at || new Date().toISOString(),
      last_checkpoint_at: new Date().toISOString(),
      last_turn_id: state.current_turn?.id || state.last_completed_turn_id || null,
      last_phase: state.current_phase || null,
      last_role: state.current_turn?.role || extra.role || null,
      run_status: state.status || null,
      checkpoint_reason: reason,
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
