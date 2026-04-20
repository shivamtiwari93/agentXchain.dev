/**
 * Stale Turn Watchdog — BUG-47 + BUG-51
 *
 * Two-tier lazy idle-threshold detection:
 *
 * 1. **Fast startup watchdog (BUG-51):** if an active turn has been
 *    `dispatched`/`starting`/`running` for >30 seconds with NO startup proof
 *    (no first-byte output recorded on the turn or in dispatch-progress) and
 *    NO staged result, it is a "ghost turn" — the subprocess never reached a
 *    healthy running state. Transitions to `failed_start` immediately.
 *
 *    Design note: the watchdog intentionally keys on first-output proof from
 *    the framework-owned dispatch-progress contract rather than `stdout.log`
 *    existence. `stdout.log` is adapter-authored visibility output and may be
 *    absent even when the adapter is wired correctly. First-output timestamps
 *    and output-line counters are the stable health contract across runtime
 *    wiring.
 *
 * 2. **Stale turn watchdog (BUG-47):** if an active turn has status "running"
 *    for >N minutes with no event log activity AND no staged result file,
 *    report it as stalled.
 *
 * Fires on CLI invocations (status, resume, step --resume) rather than
 * requiring a background daemon.
 *
 * Default thresholds:
 *   - Startup watchdog: 30 seconds (configurable via run_loop.startup_watchdog_ms
 *     or runtimes.<id>.startup_watchdog_ms for local_cli runtimes)
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
import { isPersistedTurnStartupProofStream } from './dispatch-streams.js';
import { hasMeaningfulStagedResult } from './staged-result-proof.js';

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
 * A ghost turn is one that has been in `dispatched`, `starting`, `running`, or
 * `retrying` longer than the startup watchdog threshold (default 30s) AND has:
 *   - no startup proof (no `first_output_at` on the turn or dispatch-progress,
 *     and no recorded output line counts)
 *   - no staged result file
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

  for (const [turnId, turn] of Object.entries(activeTurns)) {
    if (!['dispatched', 'starting', 'running', 'retrying'].includes(turn.status)) continue;

    const lifecycleStart = parseGhostLifecycleStart(turn);
    if (!Number.isFinite(lifecycleStart)) continue;

    // BUG-54 follow-up: per-turn threshold honors per-runtime startup override.
    // Without this, an operator who sets `runtimes.<id>.startup_watchdog_ms`
    // higher than the global to accommodate a slow QA/Claude runtime would still
    // have ghost detection fire at the global threshold, defeating the override.
    const runtime = config?.runtimes?.[turn.runtime_id];
    const startupThreshold = resolveStartupThreshold(config, runtime);

    const runningMs = now - lifecycleStart;
    if (runningMs < startupThreshold) continue;

    const progressPath = join(root, getDispatchProgressRelativePath(turnId));
    const progress = readDispatchProgressSafe(progressPath);

    if (hasTurnScopedStagedResult(root, turnId)) continue;
    if (hasStartupProof(turn, progress)) continue;

    const runningSeconds = Math.floor(runningMs / 1000);
    const failureType = classifyStartupFailureType(turn, progress);
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
    const applied = applyStartupFailureToActiveTurn(activeTurns, budgetReservations, entry, nowIso);
    if (applied) {
      emitStartupFailureEvent(root, state, entry);
      changed = true;
    }
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

  const nextState = buildBlockedStateFromEntries(state, activeTurns, budgetReservations, ghosts, stale, nowIso);
  const primary = [...ghosts, ...stale][0];
  const category = ghosts.length > 0 ? 'ghost_turn' : 'stale_turn';

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

function resolveStartupThreshold(config, runtime) {
  // BUG-54 follow-up: per-runtime override beats the global.
  // Mirrors `resolveStartupWatchdogMs()` in local-cli-adapter.js so the
  // ghost-detection scanner uses the same threshold the in-flight adapter
  // watchdog uses; otherwise the scanner pre-empts the override.
  if (runtime && runtime.type === 'local_cli'
      && Number.isInteger(runtime.startup_watchdog_ms)
      && runtime.startup_watchdog_ms > 0) {
    return runtime.startup_watchdog_ms;
  }
  const configThreshold = config?.run_loop?.startup_watchdog_ms;
  if (typeof configThreshold === 'number' && configThreshold > 0) {
    return configThreshold;
  }
  return DEFAULT_STARTUP_WATCHDOG_MS;
}

export function failTurnStartup(root, state, config, turnId, details = {}) {
  if (!state || typeof state !== 'object') {
    return { ok: false, error: 'No governed state found' };
  }

  const turn = state.active_turns?.[turnId];
  if (!turn) {
    return { ok: false, error: `Turn ${turnId} not found in active turns` };
  }
  const runtime = config?.runtimes?.[turn.runtime_id];

  const nowIso = new Date().toISOString();
  const activeTurns = { ...(state.active_turns || {}) };
  const budgetReservations = { ...(state.budget_reservations || {}) };
  const entry = {
    turn_id: turnId,
    role: turn.assigned_role || 'unknown',
    runtime_id: turn.runtime_id || 'unknown',
    running_ms: details.running_ms ?? computeLifecycleAgeMs(turn),
    threshold_ms: details.threshold_ms ?? resolveStartupThreshold(config, runtime),
    failure_type: classifyStartupFailureType(turn, null, details.failure_type || 'no_subprocess_output'),
    recommendation: details.recommendation
      || `Turn ${turnId} failed to start cleanly. Run \`agentxchain reissue-turn --turn ${turnId} --reason ghost\` to recover.`,
  };

  if (!applyStartupFailureToActiveTurn(activeTurns, budgetReservations, entry, nowIso)) {
    return { ok: false, error: `Turn ${turnId} is not eligible for startup failure transition` };
  }

  const nextState = buildBlockedStateFromEntries(state, activeTurns, budgetReservations, [entry], [], nowIso);
  safeWriteJson(join(root, '.agentxchain', 'state.json'), nextState);
  emitStartupFailureEvent(root, state, entry);
  emitRunEvent(root, 'run_blocked', {
    run_id: nextState.run_id || null,
    phase: nextState.phase || null,
    status: 'blocked',
    turn: { turn_id: entry.turn_id, role_id: entry.role },
    payload: {
      category: 'ghost_turn',
      ghost_turn_ids: [entry.turn_id],
      stalled_turn_ids: [],
    },
  });
  return { ok: true, state: nextState, turn: nextState.active_turns?.[turnId] || null };
}

function hasRecentTurnEventActivity(root, turnId, startedAt, threshold, now) {
  try {
    const events = readRunEvents(root, { limit: 200 });
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.turn?.turn_id !== turnId) continue;
      if (
        event.event_type === 'turn_stalled'
        || event.event_type === 'turn_start_failed'
        || event.event_type === 'runtime_spawn_failed'
        || event.event_type === 'stdout_attach_failed'
      ) continue;
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

function applyStartupFailureToActiveTurn(activeTurns, budgetReservations, entry, nowIso) {
  const turn = activeTurns[entry.turn_id];
  if (!turn || !['dispatched', 'starting', 'running', 'retrying'].includes(turn.status)) {
    return false;
  }

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
  delete budgetReservations[entry.turn_id];
  return true;
}

function emitStartupFailureEvent(root, state, entry) {
  const payload = {
    running_ms: entry.running_ms,
    threshold_ms: entry.threshold_ms,
    runtime_id: entry.runtime_id,
    failure_type: entry.failure_type,
    recommendation: entry.recommendation,
  };
  const details = {
    run_id: state?.run_id || null,
    phase: state?.phase || null,
    status: 'blocked',
    turn: { turn_id: entry.turn_id, role_id: entry.role },
    payload,
  };
  emitRunEvent(root, 'turn_start_failed', details);
  const failureEventType = mapStartupFailureEventType(entry.failure_type);
  if (failureEventType) {
    emitRunEvent(root, failureEventType, details);
  }
}

function buildBlockedStateFromEntries(state, activeTurns, budgetReservations, ghosts, stale, nowIso) {
  const allDetected = [...ghosts, ...stale];
  const primary = allDetected[0];
  const category = ghosts.length > 0 ? 'ghost_turn' : 'stale_turn';
  const blockedOn = allDetected.length === 1
    ? `turn:${primary.failure_type ? 'failed_start' : 'stalled'}:${primary.turn_id}`
    : ghosts.length > 0 ? 'turns:failed_start' : 'turns:stalled';

  return {
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
}

function parseGhostLifecycleStart(turn) {
  if (turn.status === 'dispatched') {
    return Date.parse(turn.dispatched_at || turn.assigned_at || '');
  }
  return Date.parse(turn.started_at || turn.dispatched_at || turn.assigned_at || '');
}

function computeLifecycleAgeMs(turn) {
  const start = parseGhostLifecycleStart(turn);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Date.now() - start);
}

function readDispatchProgressSafe(progressPath) {
  if (!existsSync(progressPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(progressPath, 'utf8'));
  } catch {
    return null;
  }
}

function classifyStartupFailureType(turn, progress, fallback = 'no_subprocess_output') {
  if (fallback === 'runtime_spawn_failed' || fallback === 'stdout_attach_failed') {
    return fallback;
  }
  if (turn?.status === 'dispatched') {
    return 'runtime_spawn_failed';
  }
  const hasWorkerAttachProof = Boolean(
    turn?.worker_attached_at
    || turn?.worker_pid != null
    || progress?.pid != null,
  );
  if (turn?.status === 'starting' || hasWorkerAttachProof) {
    return 'stdout_attach_failed';
  }
  return fallback;
}

function mapStartupFailureEventType(failureType) {
  if (failureType === 'runtime_spawn_failed') {
    return 'runtime_spawn_failed';
  }
  if (failureType === 'stdout_attach_failed') {
    return 'stdout_attach_failed';
  }
  return null;
}

function hasStartupProof(turn, progress) {
  // DEC-BUG54-STDERR-IS-NOT-STARTUP-PROOF-002 (Turn 88) extended to the
  // fast-startup watchdog in Turn 89: stderr activity is not startup proof.
  // A subprocess that spawns and emits stderr-only text must still be caught
  // by the fast watchdog as stdout_attach_failed. Only stdout-derived signals
  // (stream-tagged `turn.first_output_at`, `progress.first_output_at`, or
  // `progress.output_lines`) satisfy startup proof. `progress.stderr_lines`
  // deliberately does NOT.
  if (turn.first_output_at && isPersistedTurnStartupProofStream(turn.first_output_stream)) {
    return true;
  }
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  if (progress.first_output_at) {
    return true;
  }
  return Number(progress.output_lines || 0) > 0;
}

function hasTurnScopedStagedResult(root, turnId) {
  const turnScopedPath = join(root, getTurnStagingResultPath(turnId));
  if (hasMeaningfulStagedResult(turnScopedPath)) {
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
