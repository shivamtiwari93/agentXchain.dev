/**
 * ghost-retry.js — Pure decision helper for BUG-61 continuous-mode ghost-turn
 * auto-recovery.
 *
 * This module is deliberately pure (no disk I/O, no subprocess spawn): it takes
 * the blocked governed state plus the continuous session snapshot and returns a
 * decision record the continuous loop can act on.
 *
 * Slice 2a ships the decision helper + state-shape primitives. Slice 2b wires
 * it into `advanceContinuousRunOnce()` and covers `reissueTurn()` side-effects
 * + cooldowns + command-chain beta scenarios.
 *
 * Contracts:
 *   - Retry is eligible ONLY when `blocked_reason.category === "ghost_turn"`
 *     AND an active turn exists with `status === "failed_start"` AND a typed
 *     BUG-51 startup failure (`runtime_spawn_failed` or `stdout_attach_failed`).
 *   - Retry budget is run-scoped: switching `run_id` resets the counter to 0.
 *   - Staged results on the ghost turn disqualify retry (defer to accept flow).
 *   - Exhaustion returns `decision: "exhausted"` — the caller is responsible
 *     for mirroring the outcome into governed state's
 *     `blocked_reason.recovery.detail` per DEC-BUG61-GHOST-RETRY-STATE-OWNERSHIP-001.
 */

export const GHOST_FAILURE_TYPES = Object.freeze([
  'runtime_spawn_failed',
  'stdout_attach_failed',
]);

/**
 * Read (or default) the ghost_retry state object from a continuous session.
 * Returns a plain object; callers should spread/clone before mutating.
 */
export function readGhostRetryState(session) {
  const gr = session?.ghost_retry;
  if (!gr || typeof gr !== 'object') {
    return {
      run_id: null,
      attempts: 0,
      max_retries_per_run: null,
      last_old_turn_id: null,
      last_new_turn_id: null,
      last_failure_type: null,
      last_retried_at: null,
      exhausted: false,
    };
  }
  return {
    run_id: gr.run_id ?? null,
    attempts: Number.isInteger(gr.attempts) && gr.attempts >= 0 ? gr.attempts : 0,
    max_retries_per_run: Number.isInteger(gr.max_retries_per_run) ? gr.max_retries_per_run : null,
    last_old_turn_id: gr.last_old_turn_id ?? null,
    last_new_turn_id: gr.last_new_turn_id ?? null,
    last_failure_type: gr.last_failure_type ?? null,
    last_retried_at: gr.last_retried_at ?? null,
    exhausted: Boolean(gr.exhausted),
  };
}

/**
 * Reset the ghost_retry counter when the active run_id differs from the last
 * recorded run_id. Returns the reset state (does not mutate input).
 */
export function resetGhostRetryForRun(session, runId) {
  const current = readGhostRetryState(session);
  if (current.run_id === runId) return current;
  return {
    run_id: runId ?? null,
    attempts: 0,
    max_retries_per_run: current.max_retries_per_run,
    last_old_turn_id: null,
    last_new_turn_id: null,
    last_failure_type: null,
    last_retried_at: null,
    exhausted: false,
  };
}

/**
 * Locate the primary ghost turn from governed state.
 *
 * Inputs expected (matches shape written by `stale-turn-watchdog.js`):
 *   - `state.blocked_reason.category === "ghost_turn"`
 *   - `state.blocked_reason.turn_id`
 *   - `state.active_turns[turnId].status === "failed_start"`
 *   - `state.active_turns[turnId].failed_start_reason` is one of
 *     GHOST_FAILURE_TYPES
 *
 * Returns the turn object + failure type, or null when no eligible turn is
 * found. Does NOT consult disk.
 */
export function findPrimaryGhostTurn(state) {
  if (!state || typeof state !== 'object') return null;
  const blockedReason = state.blocked_reason;
  if (!blockedReason || blockedReason.category !== 'ghost_turn') return null;

  const activeTurns = state.active_turns || {};
  const hintedTurnId = blockedReason.turn_id;
  const candidateIds = hintedTurnId && activeTurns[hintedTurnId]
    ? [hintedTurnId]
    : Object.keys(activeTurns);

  for (const turnId of candidateIds) {
    const turn = activeTurns[turnId];
    if (!turn) continue;
    if (turn.status !== 'failed_start') continue;
    const failureType = turn.failed_start_reason;
    if (!GHOST_FAILURE_TYPES.includes(failureType)) continue;
    if (hasMeaningfulStagedResult(turn)) continue;
    return { turn_id: turnId, turn, failure_type: failureType };
  }
  return null;
}

/**
 * Best-effort detector for a meaningful staged result. If the turn has already
 * produced a structured result the caller should NOT auto-retry — the accept
 * pipeline owns that path.
 */
function hasMeaningfulStagedResult(turn) {
  if (!turn) return false;
  const staged = turn.staged_result ?? turn.result ?? null;
  if (!staged) return false;
  if (typeof staged !== 'object') return Boolean(staged);
  // Ignore purely-null / empty shells the watchdog may leave behind.
  for (const value of Object.values(staged)) {
    if (value !== null && value !== undefined && value !== '') return true;
  }
  return false;
}

/**
 * Classify the retry decision given the current blocked state + session +
 * resolved options.
 *
 * @param {object} params
 * @param {object} params.state                - governed state (has blocked_reason + active_turns)
 * @param {object} params.session              - continuous session (source of truth for retry counter)
 * @param {object} params.autoRetryOnGhost     - resolved continuous options block: { enabled, maxRetriesPerRun, cooldownSeconds }
 * @param {string|null} [params.runId]         - the run_id the continuous loop believes is active (defaults to state.run_id)
 * @returns {{
 *   decision: 'retry' | 'exhausted' | 'skip_non_ghost' | 'missing_active_ghost' | 'disabled' | 'missing_run_id',
 *   reason: string,
 *   attempts: number,
 *   maxRetries: number,
 *   retryState: object,
 *   ghost?: { turn_id: string, failure_type: string }
 * }}
 */
export function classifyGhostRetryDecision({ state, session, autoRetryOnGhost, runId } = {}) {
  const opts = autoRetryOnGhost || {};
  const enabled = Boolean(opts.enabled);
  const maxRetries = Number.isInteger(opts.maxRetriesPerRun) && opts.maxRetriesPerRun > 0
    ? opts.maxRetriesPerRun
    : 3;

  if (!enabled) {
    return {
      decision: 'disabled',
      reason: 'auto_retry_on_ghost.enabled is false',
      attempts: 0,
      maxRetries,
      retryState: readGhostRetryState(session),
    };
  }

  const category = state?.blocked_reason?.category;
  if (category !== 'ghost_turn') {
    return {
      decision: 'skip_non_ghost',
      reason: `blocked_reason.category=${category ?? 'null'} is not ghost_turn`,
      attempts: 0,
      maxRetries,
      retryState: readGhostRetryState(session),
    };
  }

  const ghost = findPrimaryGhostTurn(state);
  if (!ghost) {
    return {
      decision: 'missing_active_ghost',
      reason: 'blocked_reason names a ghost but no active turn has a typed BUG-51 failed_start',
      attempts: 0,
      maxRetries,
      retryState: readGhostRetryState(session),
    };
  }

  const effectiveRunId = runId ?? state?.run_id ?? null;
  if (!effectiveRunId) {
    return {
      decision: 'missing_run_id',
      reason: 'cannot scope retry counter without a run_id',
      attempts: 0,
      maxRetries,
      retryState: readGhostRetryState(session),
      ghost: { turn_id: ghost.turn_id, failure_type: ghost.failure_type },
    };
  }

  const resetState = resetGhostRetryForRun(session, effectiveRunId);
  const attempts = resetState.attempts;

  if (attempts >= maxRetries) {
    return {
      decision: 'exhausted',
      reason: `retry budget exhausted (${attempts}/${maxRetries})`,
      attempts,
      maxRetries,
      retryState: { ...resetState, max_retries_per_run: maxRetries, exhausted: true },
      ghost: { turn_id: ghost.turn_id, failure_type: ghost.failure_type },
    };
  }

  return {
    decision: 'retry',
    reason: `retry budget available (${attempts}/${maxRetries})`,
    attempts,
    maxRetries,
    retryState: { ...resetState, max_retries_per_run: maxRetries },
    ghost: { turn_id: ghost.turn_id, failure_type: ghost.failure_type },
  };
}

/**
 * Apply a successful auto-retry to a session snapshot. Returns a NEW session
 * object with the ghost_retry counter incremented and last_* fields updated.
 * Does not write to disk; the caller owns persistence.
 */
export function applyGhostRetryAttempt(session, { runId, oldTurnId, newTurnId, failureType, maxRetries, nowIso }) {
  const base = resetGhostRetryForRun(session, runId);
  const ghost_retry = {
    run_id: runId ?? null,
    attempts: base.attempts + 1,
    max_retries_per_run: Number.isInteger(maxRetries) ? maxRetries : base.max_retries_per_run,
    last_old_turn_id: oldTurnId ?? null,
    last_new_turn_id: newTurnId ?? null,
    last_failure_type: failureType ?? null,
    last_retried_at: nowIso || new Date().toISOString(),
    exhausted: false,
  };
  return { ...(session || {}), ghost_retry };
}

/**
 * Apply an exhaustion outcome to a session snapshot. Returns a NEW session
 * with the counter preserved, `exhausted: true`, and last-failure metadata.
 */
export function applyGhostRetryExhaustion(session, { runId, failureType, turnId, maxRetries, nowIso }) {
  const base = resetGhostRetryForRun(session, runId);
  const ghost_retry = {
    run_id: runId ?? null,
    attempts: base.attempts,
    max_retries_per_run: Number.isInteger(maxRetries) ? maxRetries : base.max_retries_per_run,
    last_old_turn_id: turnId ?? base.last_old_turn_id,
    last_new_turn_id: null,
    last_failure_type: failureType ?? base.last_failure_type,
    last_retried_at: nowIso || base.last_retried_at,
    exhausted: true,
  };
  return { ...(session || {}), ghost_retry };
}

/**
 * Build the human-readable mirror string the continuous loop should write
 * into governed state's `blocked_reason.recovery.detail` at exhaustion time.
 * Matches the shape `stale-turn-watchdog.js` already uses for that field.
 */
export function buildGhostRetryExhaustionMirror({ attempts, maxRetries, failureType, manualRecoveryDetail }) {
  const count = `${attempts}/${maxRetries}`;
  const ft = failureType || 'ghost_turn';
  const suffix = manualRecoveryDetail ? ` ${manualRecoveryDetail}` : '';
  return `Auto-retry exhausted after ${count} attempts (${ft}).${suffix}`;
}
