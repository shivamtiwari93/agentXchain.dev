/**
 * Manual adapter — the honest fallback.
 *
 * Per the frozen spec (§19, §8.2), the manual adapter:
 *   - dispatch: writes a prompt package and prints operator instructions
 *   - wait:    watches for the staged turn-result.json to appear (fs polling)
 *   - collect: reads the staged file (validation happens at the orchestrator level)
 *
 * This adapter is intentionally simple. It does not parse TALK.md, does not
 * auto-route, and does not pretend to be an orchestrator.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  getDispatchPromptPath,
  getTurnStagingResultPath,
} from '../turn-paths.js';

/**
 * Print operator instructions for a manual turn.
 *
 * @param {object} state - current governed state (must have current_turn)
 * @param {object} config - normalized config
 * @param {object} [options]
 * @param {string} [options.turnId]
 */
export function printManualDispatchInstructions(state, config, options = {}) {
  const turn = resolveTargetTurn(state, options.turnId);
  const role = config.roles?.[turn.assigned_role];
  const promptPath = getDispatchPromptPath(turn.turn_id);
  const stagingPath = getTurnStagingResultPath(turn.turn_id);

  const lines = [];
  lines.push('');
  lines.push('  +---------------------------------------------------------+');
  lines.push('  |  MANUAL TURN REQUIRED                                    |');
  lines.push('  |                                                          |');
  lines.push(`  |  Role:    ${pad(turn.assigned_role, 46)}|`);
  lines.push(`  |  Turn:    ${pad(turn.turn_id, 46)}|`);
  lines.push(`  |  Phase:   ${pad(state.phase, 46)}|`);
  lines.push(`  |  Attempt: ${pad(String(turn.attempt), 46)}|`);
  lines.push('  |                                                          |');
  lines.push(`  |  Prompt:  ${pad(promptPath, 46)}|`);
  lines.push(`  |  Result:  ${pad(stagingPath, 46)}|`);
  lines.push('  |                                                          |');
  lines.push('  |  1. Read the prompt at the path above                    |');
  lines.push('  |  2. Complete the work described in the prompt             |');
  lines.push('  |  3. Write your turn result JSON to the result path       |');
  lines.push('  |                                                          |');
  lines.push('  |  The step command will detect the file and proceed.      |');
  lines.push('  +---------------------------------------------------------+');
  lines.push('');

  return lines.join('\n');
}

/**
 * Wait for the staged turn result file to appear.
 *
 * Uses polling with a configurable interval. Returns when the file exists
 * and is non-empty, or when the abort signal fires.
 *
 * @param {string} root - project root directory
 * @param {object} [options]
 * @param {number} [options.pollIntervalMs=2000] - polling interval in ms
 * @param {number} [options.timeoutMs=1200000] - max wait time (default: 20 min)
 * @param {AbortSignal} [options.signal] - abort signal to cancel waiting
 * @param {string} [options.turnId] - targeted turn id
 * @returns {Promise<{ found: boolean, timedOut: boolean, aborted: boolean }>}
 */
export async function waitForStagedResult(root, options = {}) {
  const {
    pollIntervalMs = 2000,
    timeoutMs = 1200000,
    signal,
    turnId,
  } = options;

  const stagingFile = join(root, getTurnStagingResultPath(turnId));
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Check for abort signal
    if (signal?.aborted) {
      resolve({ found: false, timedOut: false, aborted: true });
      return;
    }

    const onAbort = () => {
      clearInterval(timer);
      resolve({ found: false, timedOut: false, aborted: true });
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Initial check
    if (isStagedResultReady(stagingFile)) {
      signal?.removeEventListener('abort', onAbort);
      resolve({ found: true, timedOut: false, aborted: false });
      return;
    }

    const timer = setInterval(() => {
      // Check timeout
      if (Date.now() - startTime >= timeoutMs) {
        clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ found: false, timedOut: true, aborted: false });
        return;
      }

      // Check for file
      if (isStagedResultReady(stagingFile)) {
        clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ found: true, timedOut: false, aborted: false });
      }
    }, pollIntervalMs);
  });
}

/**
 * Check if the staged result file exists and is non-empty.
 */
function isStagedResultReady(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    return stat.size > 2; // Must be more than just "{}" or empty
  } catch {
    return false;
  }
}

/**
 * Read the staged result file without validation.
 *
 * @param {string} root - project root directory
 * @param {object} [options]
 * @param {string} [options.turnId]
 * @returns {{ ok: boolean, raw?: string, parsed?: object, error?: string }}
 */
export function readStagedResult(root, options = {}) {
  const stagingFile = join(root, getTurnStagingResultPath(options.turnId));
  try {
    const raw = readFileSync(stagingFile, 'utf8');
    const parsed = JSON.parse(raw);
    return { ok: true, raw, parsed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pad(str, width) {
  if (str.length >= width) return '...' + str.slice(-(width - 3));
  return str + ' '.repeat(width - str.length);
}

function resolveTargetTurn(state, turnId) {
  if (turnId && state?.active_turns?.[turnId]) {
    return state.active_turns[turnId];
  }
  return state?.current_turn || Object.values(state?.active_turns || {})[0];
}
