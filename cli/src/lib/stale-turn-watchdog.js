/**
 * Stale Turn Watchdog — BUG-47
 *
 * Lazy idle-threshold detection: if an active turn has status "running"
 * for >N seconds with no event log activity AND no staged result file,
 * report it as stalled.
 *
 * Fires on CLI invocations (status, resume, step --resume) rather than
 * requiring a background daemon.
 *
 * Default thresholds:
 *   - local_cli turns: 10 minutes
 *   - api_proxy turns: 5 minutes
 *   - Configurable via run_loop.stale_turn_threshold_ms in agentxchain.json
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { emitRunEvent } from './run-events.js';

const DEFAULT_LOCAL_CLI_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_API_PROXY_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes

/**
 * Check all active turns for stale "running" status.
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state
 * @param {object} config - normalized config
 * @returns {Array<{ turn_id: string, role: string, runtime_id: string, running_ms: number, threshold_ms: number, recommendation: string }>}
 */
export function detectStaleTurns(root, state, config) {
  const activeTurns = state?.active_turns || {};
  const stale = [];
  const now = Date.now();

  for (const [turnId, turn] of Object.entries(activeTurns)) {
    if (turn.status !== 'running' && turn.status !== 'retrying') continue;
    if (!turn.started_at) continue;

    const startedAt = new Date(turn.started_at).getTime();
    if (isNaN(startedAt)) continue;

    const runningMs = now - startedAt;
    const threshold = resolveThreshold(turn, config);

    if (runningMs < threshold) continue;

    // Check if there is a staged result file — if so, the turn has
    // finished but acceptance hasn't happened yet. Not stale.
    const stagingPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
    if (existsSync(stagingPath)) continue;

    // Check for recent dispatch progress — if a dispatch-progress file
    // exists with recent activity, the turn is still active.
    const progressPath = join(root, '.agentxchain', 'dispatch-progress', `${turnId}.json`);
    if (existsSync(progressPath)) {
      try {
        const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
        const lastActivity = progress.last_activity_at
          ? new Date(progress.last_activity_at).getTime()
          : 0;
        // If there was activity within the threshold, not stale
        if (lastActivity > 0 && (now - lastActivity) < threshold) continue;
      } catch {
        // ignore parse errors
      }
    }

    // Check for recent events in events.jsonl — if there are events more
    // recent than the threshold, the turn is still producing output.
    if (hasRecentEventActivity(root, threshold, now)) continue;

    const runningMinutes = Math.floor(runningMs / 60000);
    stale.push({
      turn_id: turnId,
      role: turn.assigned_role || 'unknown',
      runtime_id: turn.runtime_id || 'unknown',
      running_ms: runningMs,
      threshold_ms: threshold,
      recommendation: `Turn ${turnId} has been running for ${runningMinutes}m with no output. `
        + `Run \`agentxchain reissue-turn --turn ${turnId} --reason stale\` to recover.`,
    });
  }

  return stale;
}

/**
 * Detect stale turns and emit turn_stalled events for each.
 * Returns the stale turn list for caller display.
 */
export function detectAndEmitStaleTurns(root, state, config) {
  const stale = detectStaleTurns(root, state, config);

  for (const entry of stale) {
    emitRunEvent(root, 'turn_stalled', {
      run_id: state?.run_id || null,
      phase: state?.phase || null,
      status: state?.status || null,
      turn: { turn_id: entry.turn_id, role_id: entry.role },
      payload: {
        running_ms: entry.running_ms,
        threshold_ms: entry.threshold_ms,
        runtime_id: entry.runtime_id,
        recommendation: entry.recommendation,
      },
    });
  }

  return stale;
}

// ── Internal ────────────────────────────────────────────────────────────────

function resolveThreshold(turn, config) {
  // Config override takes precedence
  const configThreshold = config?.run_loop?.stale_turn_threshold_ms;
  if (typeof configThreshold === 'number' && configThreshold > 0) {
    return configThreshold;
  }

  // Runtime-type-based defaults
  const runtimeId = turn.runtime_id || '';
  const runtimeConfig = config?.runtimes?.[runtimeId];
  const runtimeType = runtimeConfig?.type || '';

  if (runtimeType === 'api_proxy') {
    return DEFAULT_API_PROXY_THRESHOLD_MS;
  }

  return DEFAULT_LOCAL_CLI_THRESHOLD_MS;
}

function hasRecentEventActivity(root, threshold, now) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  if (!existsSync(eventsPath)) return false;

  try {
    // Check file mtime first as a fast path
    const stat = statSync(eventsPath);
    const mtime = stat.mtimeMs;
    if ((now - mtime) < threshold) {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}
