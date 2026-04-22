# Tester Quote-Back Ask V4

Purpose: give the human a copy-pasteable ask for the tester so BUG-61 (ghost-turn auto-recovery) can close on real shipped-package evidence instead of agent-side proof.

Use this when asking the tester to exercise `run_loop.continuous.auto_retry_on_ghost` on `agentxchain@2.154.7` or later. The behavior spec is `.planning/BUG_61_GHOST_TURN_AUTO_RECOVERY_SPEC.md`; the operator-facing surface lives in `website-v2/docs/releases/v2-153-0.mdx` (BUG-61 section) and `website-v2/docs/lights-out-operation.mdx`. This ask is self-contained — no separate runbook to follow.

Companion asks:
- BUG-52 third variant: `.planning/TESTER_QUOTEBACK_ASK_V1.md`
- BUG-59 / BUG-54: `.planning/TESTER_QUOTEBACK_ASK_V2.md`
- BUG-62 reconcile-state: `.planning/TESTER_QUOTEBACK_ASK_V3.md`

---

## Copy-Paste Message

Please re-test BUG-61 on the published package and paste literal event output for one or both of the evidence blocks below.

Target package: `agentxchain@2.154.7` or later. Earlier versions are not valid for this ask because they predate the shipped BUG-52 third-variant fix set and the BUG-61 slice-2c signature-repeat early stop; evidence on `2.153.0` alone will still be rejected if it omits the `exhaustion_reason` or `signature_repeat` fields shipped later.

Preflight from a clean shell:

```bash
npm uninstall -g agentxchain 2>/dev/null || true
npx --yes -p agentxchain@2.154.7 -c "agentxchain --version"
```

Expected version output: `2.154.7` or a later published patch.

BUG-61 auto-retry is opt-in by design under `DEC-BUG61-FULL-AUTO-DETECTOR-STRICT-V1-001`. Enable it either via approval-policy posture (`approval_policy.phase_transitions.default === "auto_approve"` AND `approval_policy.run_completion.action === "auto_approve"`) or via the explicit CLI flag below. Evidence collected without one of those preconditions is expected to show manual `reissue-turn` recovery, not `auto_retried_ghost`; that is correct behavior, not a BUG-61 regression.

Run the continuous session in a real governed project (e.g., `tusq.dev`) — **not** a scratch `agentxchain init` — so the ghost failure mode reflects a real adapter-path dispatch. Force the ghost by configuring a deliberately short `runtimes.<id>.startup_watchdog_ms` (e.g., `1500`) so `local_cli` dispatches hit `runtime_spawn_failed` or `stdout_attach_failed`.

```bash
npx --yes -p agentxchain@2.154.7 agentxchain run --continuous \
  --auto-retry-on-ghost \
  --auto-retry-on-ghost-max-retries 3 \
  --auto-retry-on-ghost-cooldown-seconds 5
```

Paste output for at least one of the two evidence blocks below. Both blocks are welcome if the session produces both outcomes.

### Block 1 — positive (auto-retry succeeds, run proceeds without operator intervention)

```bash
# Ghost auto-retry events (type, attempt counter, retry cap, failure class, runtime, reissue turn ids).
jq -c 'select(.event_type == "auto_retried_ghost") | {event_type, run_id, timestamp, payload: {attempt: .payload.attempt, max_retries_per_run: .payload.max_retries_per_run, failure_type: .payload.failure_type, runtime_id: .payload.runtime_id, old_turn_id: .payload.old_turn_id, new_turn_id: .payload.new_turn_id, running_ms: .payload.running_ms, threshold_ms: .payload.threshold_ms}}' .agentxchain/events.jsonl

# Confirm no exhaustion event fired in this window.
jq -c 'select(.event_type == "ghost_retry_exhausted") | {event_type, timestamp}' .agentxchain/events.jsonl || echo "NO_EXHAUSTION_EVENT"

# Continuous-session retry counter witness.
jq '{status: .status, runs_completed: .runs_completed, ghost_retry: {run_id: .ghost_retry.run_id, attempts: .ghost_retry.attempts, max_retries_per_run: .ghost_retry.max_retries_per_run, exhausted: .ghost_retry.exhausted, last_failure_type: .ghost_retry.last_failure_type, last_old_turn_id: .ghost_retry.last_old_turn_id, last_new_turn_id: .ghost_retry.last_new_turn_id}}' .agentxchain/continuous-session.json

# Run status proves no ghost-category block remains.
agentxchain status --json | jq '{run_id: .run_id, status: .status, blocked_reason_category: (.blocked_reason.category // null)}'
```

Required shape:
- At least one `auto_retried_ghost` row with `attempt: 1`, `max_retries_per_run: 3`, `failure_type` equal to `runtime_spawn_failed` or `stdout_attach_failed`, and distinct `old_turn_id` / `new_turn_id` short SHAs.
- `NO_EXHAUSTION_EVENT` printed (no `ghost_retry_exhausted` row in the same window).
- `continuous-session.json::ghost_retry.exhausted: false` and `attempts` equal to the `auto_retried_ghost` row count.
- `agentxchain status --json` shows `status != "blocked"` OR the blocked category is something other than `ghost_turn`.

### Block 2 — negative (auto-retry exhausts, run pauses with diagnostic bundle + manual recovery)

Run the same session with a failing runtime that reproduces the ghost indefinitely (e.g., keep the short startup watchdog in place so every reissued turn also ghosts). After the session pauses, paste:

```bash
# Ghost auto-retry events before exhaustion.
jq -c 'select(.event_type == "auto_retried_ghost") | {event_type, payload: {attempt: .payload.attempt, max_retries_per_run: .payload.max_retries_per_run, failure_type: .payload.failure_type, runtime_id: .payload.runtime_id}}' .agentxchain/events.jsonl

# Exhaustion event with reason + signature + diagnostic bundle.
jq -c 'select(.event_type == "ghost_retry_exhausted") | {event_type, run_id, timestamp, payload: {turn_id: .payload.turn_id, attempts: .payload.attempts, max_retries_per_run: .payload.max_retries_per_run, failure_type: .payload.failure_type, runtime_id: .payload.runtime_id, exhaustion_reason: .payload.exhaustion_reason, signature_repeat: .payload.signature_repeat, diagnostic_bundle: {final_signature: .payload.diagnostic_bundle.final_signature, attempts_log_length: (.payload.diagnostic_bundle.attempts_log | length)}, recovery_action: .payload.diagnostic_refs.recovery_action}}' .agentxchain/events.jsonl

# Governed state mirror of the exhaustion + manual-recovery string.
jq '{status: .status, blocked_category: .blocked_reason.category, recovery_detail: .blocked_reason.recovery.detail, recovery_action: .blocked_reason.recovery.recovery_action}' .agentxchain/state.json

# Continuous-session attempts_log with per-attempt stderr/exit fields present (may be null-valued).
jq '{status: .status, ghost_retry: {attempts: .ghost_retry.attempts, exhausted: .ghost_retry.exhausted, attempts_log: [.ghost_retry.attempts_log[] | {old_turn_id, new_turn_id, failure_type, stderr_excerpt_present: (has("stderr_excerpt")), exit_code_present: (has("exit_code")), exit_signal_present: (has("exit_signal"))}]}}' .agentxchain/continuous-session.json
```

Required shape:
- Exactly one `ghost_retry_exhausted` row for the blocked run, with `exhaustion_reason` equal to `retry_budget_exhausted` OR `same_signature_repeat`.
- When `exhaustion_reason == "same_signature_repeat"`, `signature_repeat.signature` and `signature_repeat.consecutive` are populated.
- `diagnostic_bundle.final_signature` is a non-null string AND `diagnostic_bundle.attempts_log_length >= 2`.
- `state.json::status == "blocked"` AND `blocked_reason.category == "ghost_turn"`.
- `state.json::blocked_reason.recovery.detail` contains `reissue-turn --turn <id> --reason ghost` so the manual recovery command stays visible even after auto-retry gave up.
- Every `continuous-session.json::ghost_retry.attempts_log` entry reports `stderr_excerpt_present: true`, `exit_code_present: true`, `exit_signal_present: true` — the key presence contract from slice 2d. Values may legitimately be null; the keys must exist.

### Block 3 — SUMMARY counters (both blocks)

Paste the following single-line counter object for the same window so silent omissions cannot pass:

```bash
jq -s '{auto_retried_ghost: map(select(.event_type == "auto_retried_ghost")) | length, ghost_retry_exhausted: map(select(.event_type == "ghost_retry_exhausted")) | length, runtime_spawn_failed: map(select(.event_type == "runtime_spawn_failed")) | length, stdout_attach_failed: map(select(.event_type == "stdout_attach_failed")) | length}' .agentxchain/events.jsonl
```

Required shape:
- For Block 1 (positive): `auto_retried_ghost >= 1`, `ghost_retry_exhausted == 0`.
- For Block 2 (negative): `auto_retried_ghost >= 2`, `ghost_retry_exhausted == 1`.
- `runtime_spawn_failed + stdout_attach_failed >= auto_retried_ghost` — every auto-retry must have been preceded by a typed startup failure. A quote-back that shows `auto_retried_ghost` without any preceding typed failure is suspicious and must be rejected.

---

## Review Rules For Agents

Reject BUG-61 quote-back if:

- Version is lower than `2.154.7`.
- Neither the full-auto approval-policy posture nor the `--auto-retry-on-ghost` flag was in effect — in that case auto-retry is **disabled by design** and manual `reissue-turn` is the expected recovery. File the output under BUG-61 opt-in clarification, do NOT close BUG-61.
- Block 1 shows `auto_retried_ghost` rows but the `failure_type` is not in `{runtime_spawn_failed, stdout_attach_failed}` — auto-retry must only fire on typed startup failures per `DEC-BUG61-GHOST-SCOPE-STARTUP-ONLY-001`. Any other classification is scope creep and must be investigated before closure.
- Block 2 shows `ghost_retry_exhausted` but `exhaustion_reason` is missing, OR `diagnostic_bundle.final_signature` is null, OR `attempts_log_length < 2`.
- Block 2 governed-state mirror lacks the manual `reissue-turn --turn <id> --reason ghost` recovery string — the manual escape hatch must stay visible after auto-retry gives up per the BUG-61 spec "Exhaustion Flow" clause.
- Block 3 SUMMARY shows `auto_retried_ghost` rows without any preceding `runtime_spawn_failed` or `stdout_attach_failed` rows — the ghost detection typed-failure contract from BUG-51/BUG-54 is what BUG-61 auto-retries, and missing typed failures means the evidence is not actually exercising BUG-61.
- Any required command is replaced, paraphrased, or summarized rather than pasted verbatim.
- The evidence comes from an unversioned local checkout (e.g., `cd cli && node bin/agentxchain.js …`) or from the standalone `cli/scripts/reproduce-bug-54.mjs` harness rather than the published tarball's adapter path under `agentxchain run --continuous`. Closure requires shipped-package, adapter-path evidence.

When valid quote-back lands, update `.planning/HUMAN-ROADMAP.md` to flip BUG-61 to `- [x]` with completion date + tester-session pointer, record the closure decision in `.planning/DECISIONS.md`, and only then consider the BUG-61 slice-2e follow-ups (dashboard rendering, fingerprint schema hardening) that are currently deferred.

---

## Why A Separate Ask

BUG-52 (V1), BUG-59/BUG-54 (V2), and BUG-62 (V3) each sit on a distinct evidence lane. BUG-61 requires a fourth: a real continuous run with a forced ghost-class adapter failure, the opt-in precondition met, and event evidence drawn from `.agentxchain/events.jsonl` + `.agentxchain/continuous-session.json` + `.agentxchain/state.json`. Splitting keeps each tester sitting bounded and each evidence block unambiguous. BUG-61 evidence must not be mixed into V2's BUG-54 ten-dispatch adapter-path output — different closure contracts, different review rules.
