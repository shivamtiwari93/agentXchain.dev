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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeWriteJson } from './safe-write.js';
import { emitRunEvent, readRunEvents } from './run-events.js';
import { getTurnStagingResultPath } from './turn-paths.js';
import { getDispatchProgressRelativePath } from './dispatch-progress.js';

const DEFAULT_LOCAL_CLI_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_API_PROXY_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes
const LEGACY_STAGING_PATH = '.agentxchain/staging/turn-result.json';

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

    if (hasTurnScopedStagedResult(root, turnId)) continue;

    const progressPath = join(root, getDispatchProgressRelativePath(turnId));
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

    if (hasRecentTurnEventActivity(root, turnId, startedAt, threshold, now)) continue;

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
  return reconcileStaleTurns(root, state, config).stale_turns;
}

// ── Internal ────────────────────────────────────────────────────────────────

export function reconcileStaleTurns(root, state, config) {
  if (!state || typeof state !== 'object') {
    return { stale_turns: [], state, changed: false };
  }

  const stale = detectStaleTurns(root, state, config);
  if (stale.length === 0) {
    return { stale_turns: [], state, changed: false };
  }

  const nowIso = new Date().toISOString();
  const activeTurns = { ...(state.active_turns || {}) };
  let changed = false;

  for (const entry of stale) {
    const turn = activeTurns[entry.turn_id];
    if (!turn || (turn.status !== 'running' && turn.status !== 'retrying')) continue;

    activeTurns[entry.turn_id] = {
      ...turn,
      status: 'stalled',
      stalled_at: nowIso,
      stalled_reason: 'no_output_within_threshold',
      stalled_previous_status: turn.status,
      stalled_threshold_ms: entry.threshold_ms,
      stalled_running_ms: entry.running_ms,
      recovery_command: `agentxchain reissue-turn --turn ${entry.turn_id} --reason stale`,
    };
    changed = true;

    emitRunEvent(root, 'turn_stalled', {
      run_id: state?.run_id || null,
      phase: state?.phase || null,
      status: 'blocked',
      turn: { turn_id: entry.turn_id, role_id: entry.role },
      payload: {
        running_ms: entry.running_ms,
        threshold_ms: entry.threshold_ms,
        runtime_id: entry.runtime_id,
        recommendation: entry.recommendation,
      },
    });
  }

  if (!changed) {
    return { stale_turns: stale, state, changed: false };
  }

  const primary = stale[0];
  const nextState = {
    ...state,
    status: 'blocked',
    active_turns: activeTurns,
    blocked_on: stale.length === 1 ? `turn:stalled:${primary.turn_id}` : 'turns:stalled',
    blocked_reason: {
      category: 'stale_turn',
      blocked_at: nowIso,
      turn_id: primary.turn_id,
      recovery: {
        typed_reason: 'stale_turn',
        owner: 'human',
        recovery_action: primary.recommendation,
        turn_retained: true,
        detail: primary.recommendation,
      },
    },
  };

  safeWriteJson(join(root, '.agentxchain', 'state.json'), nextState);
  emitRunEvent(root, 'run_blocked', {
    run_id: nextState.run_id || null,
    phase: nextState.phase || null,
    status: 'blocked',
    turn: { turn_id: primary.turn_id, role_id: primary.role },
    payload: {
      category: 'stale_turn',
      stalled_turn_ids: stale.map((entry) => entry.turn_id),
    },
  });
  return { stale_turns: stale, state: nextState, changed: true };
}

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

function hasRecentTurnEventActivity(root, turnId, startedAt, threshold, now) {
  try {
    const events = readRunEvents(root, { limit: 200 });
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.turn?.turn_id !== turnId) continue;
      if (event.event_type === 'turn_stalled') continue;
      const timestamp = Date.parse(event.timestamp || '');
      if (!Number.isFinite(timestamp)) continue;
      if (timestamp < startedAt) continue;
      if ((now - timestamp) < threshold) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function hasTurnScopedStagedResult(root, turnId) {
  const turnScopedPath = join(root, getTurnStagingResultPath(turnId));
  if (existsSync(turnScopedPath)) {
    return true;
  }

  const legacyPath = join(root, LEGACY_STAGING_PATH);
  if (!existsSync(legacyPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(legacyPath, 'utf8'));
    return parsed?.turn_id === turnId;
  } catch {
    return false;
  }
}
