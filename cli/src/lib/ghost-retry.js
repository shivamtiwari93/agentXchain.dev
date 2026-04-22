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
 * Slice 2c: same-signature early stop threshold.
 *
 * When N consecutive recorded attempts share the same fingerprint
 * `(runtime_id, role_id, failure_type)`, the retry budget is NOT exhausted in
 * raw count terms but the pattern signals a systematic failure that further
 * retries will not clear. At that point the loop stops early with
 * `decision: "exhausted"` and `reason: "same_signature_repeat"`. The threshold
 * is deliberately low (2) because the BUG-61 contract is "retry transient
 * ghosts" — a second identical signature is already non-transient evidence.
 *
 * Not configurable via `auto_retry_on_ghost` in v1; the value is a framework
 * invariant. If evidence emerges that 2 is too aggressive, promote to config
 * through a new DEC rather than silently widening.
 */
export const SIGNATURE_REPEAT_THRESHOLD = 2;

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
      attempts_log: [],
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
    attempts_log: Array.isArray(gr.attempts_log) ? gr.attempts_log : [],
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
    attempts_log: [],
  };
}

/**
 * Build the fingerprint string for a recorded attempt. Same shape as the
 * HUMAN-ROADMAP's "same runtime, same role, same prompt shape" guidance —
 * we key on (runtime_id, role_id, failure_type). Prompt shape is implicitly
 * stable across same-turn reissues because `reissueTurn()` re-renders the
 * same dispatch bundle.
 *
 * `null`/missing fields are normalized to `?` so partial records compare
 * consistently rather than silently matching.
 */
export function buildAttemptFingerprint(attempt) {
  const runtime = attempt?.runtime_id ?? '?';
  const role = attempt?.role_id ?? '?';
  const failure = attempt?.failure_type ?? '?';
  return `${runtime}|${role}|${failure}`;
}

/**
 * Classify whether the tail of `attemptsLog` shows `threshold` consecutive
 * identical fingerprints. Returns:
 *   - `{ triggered: false, signature: null, consecutive: 0 }` when not hit
 *   - `{ triggered: true, signature, consecutive }` when hit
 *
 * The caller decides what to do with the trigger (slice 2c routes it into
 * `decision: "exhausted"` with `reason: "same_signature_repeat"`).
 */
export function classifySameSignatureExhaustion(attemptsLog, threshold = SIGNATURE_REPEAT_THRESHOLD) {
  if (!Array.isArray(attemptsLog) || attemptsLog.length < threshold) {
    return { triggered: false, signature: null, consecutive: 0 };
  }
  if (!Number.isInteger(threshold) || threshold < 2) {
    return { triggered: false, signature: null, consecutive: 0 };
  }
  const tail = attemptsLog.slice(-threshold);
  const signatures = tail.map(buildAttemptFingerprint);
  const first = signatures[0];
  if (!first || first === '?|?|?') {
    return { triggered: false, signature: null, consecutive: 0 };
  }
  const allMatch = signatures.every((s) => s === first);
  if (!allMatch) {
    return { triggered: false, signature: null, consecutive: 0 };
  }
  return { triggered: true, signature: first, consecutive: threshold };
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
 *   ghost?: { turn_id: string, failure_type: string },
 *   signatureRepeat?: { signature: string, consecutive: number }
 * }}
 *
 * Exhaustion lanes (added in slice 2c):
 *   - `reason: "retry budget exhausted (N/N)"` — raw counter cap hit
 *   - `reason: "same_signature_repeat (<signature>)"` — N consecutive
 *     identical fingerprints recorded; continuing is unlikely to help. This
 *     lane can fire BEFORE the raw counter cap — we stop as soon as the
 *     pattern is visible.
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

  // Slice 2c: same-signature early stop. If the recorded attempts log shows
  // SIGNATURE_REPEAT_THRESHOLD consecutive identical fingerprints, stop early
  // with a distinct reason so the caller can surface "pattern detected, not
  // transient" in the exhaustion bundle.
  const sigCheck = classifySameSignatureExhaustion(resetState.attempts_log, SIGNATURE_REPEAT_THRESHOLD);
  if (sigCheck.triggered) {
    return {
      decision: 'exhausted',
      reason: `same_signature_repeat (${sigCheck.signature})`,
      attempts,
      maxRetries,
      retryState: { ...resetState, max_retries_per_run: maxRetries, exhausted: true },
      ghost: { turn_id: ghost.turn_id, failure_type: ghost.failure_type },
      signatureRepeat: { signature: sigCheck.signature, consecutive: sigCheck.consecutive },
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
export function applyGhostRetryAttempt(session, {
  runId,
  oldTurnId,
  newTurnId,
  failureType,
  maxRetries,
  nowIso,
  runtimeId = null,
  roleId = null,
  runningMs = null,
  thresholdMs = null,
  stderrExcerpt = null,
  exitCode = null,
  exitSignal = null,
}) {
  const base = resetGhostRetryForRun(session, runId);
  const at = nowIso || new Date().toISOString();
  // Slice 2c: append a per-attempt fingerprint record. The log is the source
  // of truth for same-signature early-stop detection and the exhaustion
  // diagnostic bundle. We cap its size to 10 entries to prevent unbounded
  // growth on misbehaving projects — the tail is what matters for pattern
  // detection.
  //
  // Slice 2d (Turn 201): fold the per-attempt adapter `process_exit` /
  // `spawn_error` diagnostic fields (stderr_excerpt, exit_code, exit_signal)
  // into the log entry. This makes `ghost_retry_exhausted.diagnostic_bundle`
  // self-contained — an operator reading `continuous-session.json` or the
  // event payload no longer has to cross-reference
  // `.agentxchain/dispatch/turns/<turnId>/stdout.log` to see WHY the last few
  // spawns failed. Bounded by the adapter's own 800-byte stderr excerpt cap
  // (DIAGNOSTIC_STDERR_EXCERPT_LIMIT at local-cli-adapter.js:43) so session
  // state does not grow unbounded on a noisy-stderr runtime.
  const nextEntry = {
    attempt: base.attempts + 1,
    old_turn_id: oldTurnId ?? null,
    new_turn_id: newTurnId ?? null,
    runtime_id: runtimeId ?? null,
    role_id: roleId ?? null,
    failure_type: failureType ?? null,
    running_ms: runningMs ?? null,
    threshold_ms: thresholdMs ?? null,
    stderr_excerpt: typeof stderrExcerpt === 'string' && stderrExcerpt.length > 0 ? stderrExcerpt : null,
    exit_code: Number.isInteger(exitCode) ? exitCode : null,
    exit_signal: typeof exitSignal === 'string' && exitSignal.length > 0 ? exitSignal : null,
    retried_at: at,
  };
  const attemptsLog = [...base.attempts_log, nextEntry].slice(-10);
  const ghost_retry = {
    run_id: runId ?? null,
    attempts: base.attempts + 1,
    max_retries_per_run: Number.isInteger(maxRetries) ? maxRetries : base.max_retries_per_run,
    last_old_turn_id: oldTurnId ?? null,
    last_new_turn_id: newTurnId ?? null,
    last_failure_type: failureType ?? null,
    last_retried_at: at,
    exhausted: false,
    attempts_log: attemptsLog,
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
    // Slice 2c: preserve the per-attempt fingerprint log into the exhausted
    // state so the operator-facing session.json still has the diagnostic
    // payload after the loop pauses. Without this, the log would be dropped
    // exactly when it is most useful.
    attempts_log: Array.isArray(base.attempts_log) ? base.attempts_log : [],
  };
  return { ...(session || {}), ghost_retry };
}

/**
 * Build the human-readable mirror string the continuous loop should write
 * into governed state's `blocked_reason.recovery.detail` at exhaustion time.
 * Matches the shape `stale-turn-watchdog.js` already uses for that field.
 *
 * Slice 2c: accepts optional `signatureRepeat` and adds a brief inline note
 * so operators see the distinction between raw-budget exhaustion and
 * pattern-based early stop in the status surface.
 */
export function buildGhostRetryExhaustionMirror({
  attempts,
  maxRetries,
  failureType,
  manualRecoveryDetail,
  signatureRepeat = null,
}) {
  const count = `${attempts}/${maxRetries}`;
  const ft = failureType || 'ghost_turn';
  const suffix = manualRecoveryDetail ? ` ${manualRecoveryDetail}` : '';
  if (signatureRepeat && signatureRepeat.signature) {
    const sig = signatureRepeat.signature;
    const consec = signatureRepeat.consecutive || 2;
    return `Auto-retry stopped early after ${consec} consecutive same-signature attempts [${sig}] (${ft}); last attempt ${count}.${suffix}`;
  }
  return `Auto-retry exhausted after ${count} attempts (${ft}).${suffix}`;
}

/**
 * Slice 2d (Turn 201): extract the most recent `process_exit` / `spawn_error`
 * adapter diagnostic from a rendered dispatch log. The adapter writes lines of
 * the form `[adapter:diag] <label> <json>\n` (see
 * `cli/src/lib/adapters/local-cli-adapter.js::appendDiagnostic`); ghost-turn
 * failures always emit one of `process_exit` or `spawn_error` before settling.
 *
 * Returns `{ stderr_excerpt, exit_code, exit_signal }`. Each field is `null`
 * when the log is empty, malformed, or did not surface that particular field.
 * Purity: takes a string, does not read the filesystem; the caller is
 * responsible for loading the log.
 */
export function extractLatestStderrDiagnostic(dispatchLogContent) {
  if (typeof dispatchLogContent !== 'string' || dispatchLogContent.length === 0) {
    return { stderr_excerpt: null, exit_code: null, exit_signal: null };
  }
  const LABELS = new Set(['process_exit', 'spawn_error']);
  const lines = dispatchLogContent.split(/\n+/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.startsWith('[adapter:diag] ')) continue;
    const rest = line.slice('[adapter:diag] '.length);
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx <= 0) continue;
    const label = rest.slice(0, spaceIdx);
    if (!LABELS.has(label)) continue;
    const jsonText = rest.slice(spaceIdx + 1);
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== 'object') continue;
    const stderr = typeof payload.stderr_excerpt === 'string' && payload.stderr_excerpt.length > 0
      ? payload.stderr_excerpt
      : null;
    const rawExit = payload.exit_code;
    const exitCode = Number.isInteger(rawExit) ? rawExit : null;
    const rawSignal = payload.signal ?? payload.exit_signal ?? null;
    const exitSignal = typeof rawSignal === 'string' && rawSignal.length > 0 ? rawSignal : null;
    if (stderr === null && exitCode === null && exitSignal === null && label === 'process_exit') {
      // Nothing useful on this line — keep looking for an earlier entry that
      // had stderr or an exit code. Prevents a final benign process_exit from
      // masking a prior spawn_error with real evidence.
      continue;
    }
    return { stderr_excerpt: stderr, exit_code: exitCode, exit_signal: exitSignal };
  }
  return { stderr_excerpt: null, exit_code: null, exit_signal: null };
}

/**
 * Slice 2c: build the per-attempt diagnostic bundle that rides on the
 * `ghost_retry_exhausted` event payload AND gets surfaced in CLI status so
 * the operator has enough evidence to decide between (a) bumping
 * `max_retries_per_run`, (b) changing the runtime, (c) raising
 * `startup_watchdog_ms`, or (d) filing a new BUG-54-class regression.
 *
 * Output shape:
 *   {
 *     attempts_log: [...per-attempt records, most recent last...],
 *     fingerprint_summary: [{ signature, count }, ...] sorted by count desc,
 *     final_signature: string | null
 *   }
 */
export function buildGhostRetryDiagnosticBundle(sessionOrState) {
  const state = sessionOrState && typeof sessionOrState === 'object' && sessionOrState.ghost_retry
    ? readGhostRetryState(sessionOrState)
    : (Array.isArray(sessionOrState?.attempts_log)
        ? { attempts_log: sessionOrState.attempts_log }
        : { attempts_log: [] });
  const log = Array.isArray(state.attempts_log) ? state.attempts_log : [];
  const counts = new Map();
  for (const entry of log) {
    const sig = buildAttemptFingerprint(entry);
    counts.set(sig, (counts.get(sig) || 0) + 1);
  }
  const fingerprint_summary = Array.from(counts.entries())
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count);
  const final_signature = log.length > 0 ? buildAttemptFingerprint(log[log.length - 1]) : null;
  return { attempts_log: log, fingerprint_summary, final_signature };
}
