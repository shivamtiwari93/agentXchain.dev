/**
 * Stale Turn Watchdog — BUG-47 + BUG-51
 *
 * Two-tier lazy idle-threshold detection:
 *
 * 1. **Fast startup watchdog (BUG-51):** if an active turn has been dispatched
 *    for >30 seconds with NO dispatch-progress file, NO staged result, and NO
 *    recent events, it is a "ghost turn" — the subprocess never attached.
 *    Transitions to `failed_start` immediately.
 *
 *    Design note: the watchdog intentionally keys on turn-scoped
 *    dispatch-progress rather than `stdout.log` existence. Dispatch-progress is
 *    a framework-authored signal with a stable per-turn contract across runtime
 *    wiring; `stdout.log` is adapter-authored visibility output and is allowed
 *    to be best-effort. Using dispatch-progress therefore gives us the same
 *    operator-facing "no first byte / no worker heartbeat" detection without
 *    coupling the watchdog to adapter-specific log-attachment details.
 *
 * 2. **Stale turn watchdog (BUG-47):** if an active turn has status "running"
 *    for >N minutes with no event log activity AND no staged result file,
 *    report it as stalled.
 *
 * Fires on CLI invocations (status, resume, step --resume) rather than
 * requiring a background daemon.
 *
 * Default thresholds:
 *   - Startup watchdog: 30 seconds (configurable via run_loop.startup_watchdog_ms)
 *   - local_cli stale turns: 10 minutes
 *   - api_proxy stale turns: 5 minutes
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
const DEFAULT_STARTUP_WATCHDOG_MS = 30 * 1000;          // 30 seconds (BUG-51)
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
 * BUG-51: Detect ghost-dispatched turns — subprocess never started.
 *
 * A ghost turn is one that has been in "running" or "retrying" status for
 * longer than the startup watchdog threshold (default 30s) AND has:
 *   - no dispatch-progress file (framework-observed proof that no subprocess
 *     output or heartbeat was attached)
 *   - no staged result file
 *   - no recent turn-scoped events (beyond the initial turn_dispatched)
 *
 * This is a stricter, faster check than detectStaleTurns (BUG-47).
 * Ghost turns transition to "failed_start" rather than "stalled".
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state
 * @param {object} config - normalized config
 * @returns {Array<{ turn_id: string, role: string, runtime_id: string, running_ms: number, threshold_ms: number, recommendation: string, failure_type: string }>}
 */
export function detectGhostTurns(root, state, config) {
  const activeTurns = state?.active_turns || {};
  const ghosts = [];
  const now = Date.now();
  const startupThreshold = resolveStartupThreshold(config);

  for (const [turnId, turn] of Object.entries(activeTurns)) {
    if (turn.status !== 'running' && turn.status !== 'retrying') continue;
    if (!turn.started_at) continue;

    const startedAt = new Date(turn.started_at).getTime();
    if (isNaN(startedAt)) continue;

    const runningMs = now - startedAt;
    if (runningMs < startupThreshold) continue;

    // Ghost detection: NO dispatch-progress file means subprocess never attached
    const progressPath = join(root, getDispatchProgressRelativePath(turnId));
    const hasProgress = existsSync(progressPath);

    // If dispatch-progress exists, subprocess started — this is NOT a ghost turn.
    // The regular stale-turn watchdog (BUG-47) will handle it if it goes silent.
    if (hasProgress) continue;

    // Also check for staged result (unlikely without progress, but be safe)
    if (hasTurnScopedStagedResult(root, turnId)) continue;

    // Check for any turn-scoped events beyond the initial dispatch event
    if (hasRecentTurnEventActivity(root, turnId, startedAt, startupThreshold, now)) continue;

    const runningSeconds = Math.floor(runningMs / 1000);
    const failureType = 'no_subprocess_output';
    ghosts.push({
      turn_id: turnId,
      role: turn.assigned_role || 'unknown',
      runtime_id: turn.runtime_id || 'unknown',
      running_ms: runningMs,
      threshold_ms: startupThreshold,
      failure_type: failureType,
      recommendation: `Turn ${turnId} has been dispatched for ${runningSeconds}s with no subprocess output. `
        + `The subprocess likely never started. `
        + `Run \`agentxchain reissue-turn --turn ${turnId} --reason ghost\` to recover.`,
    });
  }

  return ghosts;
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
    return { stale_turns: [], ghost_turns: [], state, changed: false };
  }

  // BUG-51: Fast startup watchdog — detect ghost turns first (30s threshold)
  const ghosts = detectGhostTurns(root, state, config);

  // BUG-47: Stale turn watchdog — detect turns that started but went silent (10m threshold)
  // Exclude turns already caught by ghost detection to avoid double-counting
  const ghostIds = new Set(ghosts.map(g => g.turn_id));
  const stale = detectStaleTurns(root, state, config).filter(s => !ghostIds.has(s.turn_id));

  if (ghosts.length === 0 && stale.length === 0) {
    return { stale_turns: [], ghost_turns: [], state, changed: false };
  }

  const nowIso = new Date().toISOString();
  const activeTurns = { ...(state.active_turns || {}) };
  const budgetReservations = { ...(state.budget_reservations || {}) };
  let changed = false;

  // Process ghost turns (BUG-51) — transition to failed_start
  for (const entry of ghosts) {
    const turn = activeTurns[entry.turn_id];
    if (!turn || (turn.status !== 'running' && turn.status !== 'retrying')) continue;

    activeTurns[entry.turn_id] = {
      ...turn,
      status: 'failed_start',
      failed_start_at: nowIso,
      failed_start_reason: entry.failure_type,
      failed_start_previous_status: turn.status,
      failed_start_threshold_ms: entry.threshold_ms,
      failed_start_running_ms: entry.running_ms,
      recovery_command: `agentxchain reissue-turn --turn ${entry.turn_id} --reason ghost`,
    };
    changed = true;

    // BUG-51 fix #6: Release budget reservation for ghost turns
    delete budgetReservations[entry.turn_id];

    emitRunEvent(root, 'turn_start_failed', {
      run_id: state?.run_id || null,
      phase: state?.phase || null,
      status: 'blocked',
      turn: { turn_id: entry.turn_id, role_id: entry.role },
      payload: {
        running_ms: entry.running_ms,
        threshold_ms: entry.threshold_ms,
        runtime_id: entry.runtime_id,
        failure_type: entry.failure_type,
        recommendation: entry.recommendation,
      },
    });
  }

  // Process stale turns (BUG-47) — transition to stalled
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

    // BUG-51 fix #6: Release budget reservation for stale turns too
    delete budgetReservations[entry.turn_id];

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
    return { stale_turns: stale, ghost_turns: ghosts, state, changed: false };
  }

  const allDetected = [...ghosts, ...stale];
  const primary = allDetected[0];
  const category = ghosts.length > 0 ? 'ghost_turn' : 'stale_turn';
  const blockedOn = allDetected.length === 1
    ? `turn:${primary.failure_type ? 'failed_start' : 'stalled'}:${primary.turn_id}`
    : ghosts.length > 0 ? 'turns:failed_start' : 'turns:stalled';

  const nextState = {
    ...state,
    status: 'blocked',
    active_turns: activeTurns,
    budget_reservations: budgetReservations,
    blocked_on: blockedOn,
    blocked_reason: {
      category,
      blocked_at: nowIso,
      turn_id: primary.turn_id,
      recovery: {
        typed_reason: category,
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
      category,
      ghost_turn_ids: ghosts.map((entry) => entry.turn_id),
      stalled_turn_ids: stale.map((entry) => entry.turn_id),
    },
  });
  return { stale_turns: stale, ghost_turns: ghosts, state: nextState, changed: true };
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

function resolveStartupThreshold(config) {
  const configThreshold = config?.run_loop?.startup_watchdog_ms;
  if (typeof configThreshold === 'number' && configThreshold > 0) {
    return configThreshold;
  }
  return DEFAULT_STARTUP_WATCHDOG_MS;
}

function hasRecentTurnEventActivity(root, turnId, startedAt, threshold, now) {
  try {
    const events = readRunEvents(root, { limit: 200 });
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.turn?.turn_id !== turnId) continue;
      if (event.event_type === 'turn_stalled' || event.event_type === 'turn_start_failed') continue;
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
