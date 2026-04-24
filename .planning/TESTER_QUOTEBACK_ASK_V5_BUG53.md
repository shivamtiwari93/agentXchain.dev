# Tester Quote-Back Ask V5 (BUG-53)

Purpose: give the human a copy-pasteable ask for the tester so BUG-53 (continuous session auto-chain after run completion + clean idle-exit on exhausted vision) can close on real shipped-package evidence instead of agent-side proof.

Use this when asking the tester to exercise `agentxchain run --continuous` multi-run chain behaviour on `agentxchain@2.154.7` or later. The behaviour spec is `.planning/BUG_53_REENTRY_SPEC.md`; the audit-trail emission lives at `cli/src/lib/continuous-run.js:916-940`. This ask is self-contained — no separate runbook to follow.

Companion asks:
- BUG-52 third variant: `.planning/TESTER_QUOTEBACK_ASK_V1.md`
- BUG-59 / BUG-54: `.planning/TESTER_QUOTEBACK_ASK_V2.md`
- BUG-62 reconcile-state: `.planning/TESTER_QUOTEBACK_ASK_V3.md`
- BUG-61 ghost auto-retry: `.planning/TESTER_QUOTEBACK_ASK_V4.md`

BUG-60 (perpetual idle-expansion from ROADMAP/SYSTEM_SPEC when VISION is exhausted) is **explicitly out of scope** for this ask. BUG-53 only asks the tester to prove that (a) run N+1 automatically starts from the next vision candidate after run N completes, and (b) the session cleanly exits with `status: idle_exit` (NOT `paused`) when no vision candidate remains. Evidence that attempts to exercise BUG-60's `on_idle: 'perpetual'` branch will be rejected — BUG-60 is blocked behind its own two-agent pre-work AND the remaining BUG-59 shipped-package quote-back. BUG-52's separate shipped-package quote-back landed on `agentxchain@2.154.11`.

---

## Copy-Paste Message

Please re-test BUG-53 on the published package and paste literal output for **both** evidence blocks below. Block 1 proves run-to-run auto-chaining works end-to-end; Block 2 proves clean idle-exit when vision is exhausted. Both are required for closure because v2.150.0's tester run only produced Block 2 evidence (`Runs: 0/1`) and never exercised the auto-chain.

Target package: `agentxchain@2.154.7` or later. Earlier versions are not valid for this ask because they predate the BUG-52 third-variant fix set; older runs may get stuck on phase-gate loops and never reach the `session_continuation` emission point at all.

Preflight from a clean shell:

```bash
npm uninstall -g agentxchain 2>/dev/null || true
npx --yes -p agentxchain@2.154.7 -c "agentxchain --version"
```

Expected version output: `2.154.7` or a later published patch.

Use a **real governed project** (e.g., `tusq.dev`) — **not** a `cli/scripts/reproduce-bug-54.mjs` harness call, and **not** a fresh `agentxchain init` scratch repo with a mock executor. Closure requires shipped-package, full-run adapter-path evidence.

Ensure `.planning/VISION.md` has **at least two, but fewer than `--max-runs`, concretely derivable goals** before Block 1. Recommended shape: exactly two unchecked roadmap items or two distinct vision bullets, then run with `--max-runs 4`. This lets one current-window session prove both behaviours: run 1 → run 2 auto-chain, then clean `idle_exit` when no further goal remains. Do not mix Block 1 evidence from one session with Block 2 evidence from another session. Capture the session-start timestamp before the dogfood command so every jq filter below scopes to the same current window.

```bash
export BUG53_START_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "BUG53_START_TS=$BUG53_START_TS"

npx --yes -p agentxchain@2.154.7 agentxchain run --continuous \
  --vision .planning/VISION.md \
  --max-runs 4 \
  --max-idle-cycles 3 \
  --poll-seconds 5 \
  --triage-approval auto \
  --auto-checkpoint \
  --no-report
```

Paste output for Block 1 (positive: multi-run chain) AND Block 2 (negative: clean idle-exit on exhausted vision) AND Block 3 (SUMMARY counters).

### Block 1 — positive (run 1 completes, run 2 auto-starts, `session_continuation` event emitted)

After at least one chain transition fires (watch for `Run 1/4 completed` followed by `Run 2/4` in stdout), paste:

```bash
# Current-window session_continuation events: payload shape locked at exactly
# seven keys per DEC-BUG53-SESSION-CONTINUATION-PAYLOAD-SHAPE-001 (proposed).
# session_id, previous_run_id, next_run_id, next_objective, next_intent_id,
# runs_completed, trigger.
jq -c --arg since "$BUG53_START_TS" 'select(.event_type == "session_continuation" and .timestamp >= $since) | {event_type, run_id, timestamp, payload: {session_id: .payload.session_id, previous_run_id: .payload.previous_run_id, next_run_id: .payload.next_run_id, next_objective: .payload.next_objective, next_intent_id: .payload.next_intent_id, runs_completed: .payload.runs_completed, trigger: .payload.trigger}}' .agentxchain/events.jsonl

# Continuous-session mirror — session never entered `paused` on clean completion.
jq '{status: .status, runs_completed: .runs_completed, max_runs: .max_runs, idle_cycles: .idle_cycles, current_run_id: .current_run_id, current_vision_objective: .current_vision_objective}' .agentxchain/continuous-session.json

# Confirm session-level status is `running` (during chain) or `completed`
# (after max_runs) — never `paused` for a clean completion.
jq -r '.status' .agentxchain/continuous-session.json
```

Required shape:
- At least one `session_continuation` row with `previous_run_id` and `next_run_id` as distinct non-null run ids, `next_objective` a non-null non-empty string, `runs_completed >= 1`, and `trigger` equal to `"vision_scan"` or `"intake"`.
- The `payload` object contains exactly these seven keys and no others: `session_id`, `previous_run_id`, `next_run_id`, `next_objective`, `next_intent_id`, `runs_completed`, `trigger`. BUG-54 keys (`prompt_transport`, `env_snapshot`, `stdin_bytes`, `watchdog_ms`) and BUG-61 keys (`auto_retried_ghost`, `ghost_retry_exhausted`, `attempts_log`, `diagnostic_bundle`, `failure_type`) MUST NOT appear.
- `continuous-session.json::status` is `running` while a chain is in flight. The closure paste should later show Block 2's `idle_exit`; it must NOT be `paused`.
- `runs_completed >= 2` at the end of the window so at least one auto-chain actually fired.

### Block 2 — negative (same session vision exhausted → clean `idle_exit`, never `paused`)

Let the same command from Block 1 continue after the first `session_continuation` event until the current session exhausts all derivable goals. Do not start a second session for Block 2. The expected terminal shape is `idle_exit` with `runs_completed < max_runs`, proving the loop exited because no next vision objective was derivable, not because the max-run cap fired.

```bash
# Current-window session end state — after vision is exhausted and
# max_idle_cycles consecutive idle scans produced no derivable work.
jq '{status: .status, runs_completed: .runs_completed, max_runs: .max_runs, idle_cycles: .idle_cycles, max_idle_cycles: .max_idle_cycles}' .agentxchain/continuous-session.json

# Current-window chain transitions. Count must equal max(runs_completed - 1, 0).
jq -c --arg since "$BUG53_START_TS" 'select(.event_type == "session_continuation" and .timestamp >= $since)' .agentxchain/events.jsonl | wc -l
```

Required shape:
- `continuous-session.json::status` is `idle_exit` — NEVER `paused`. `completed` means the max-run cap fired before vision exhaustion and does not close Block 2.
- `idle_cycles >= max_idle_cycles` when `status == "idle_exit"`; `runs_completed < max_runs` is acceptable in this case (the cause is vision exhaustion, not max-runs).
- The `session_continuation` count in the window equals `max(runs_completed - 1, 0)` — one continuation event per chain transition, zero when `runs_completed` is 0 or 1.

### Block 3 — SUMMARY counters (covers both blocks)

Paste this single-line JSON object so reviewers can verify the positive and negative cases in one glance:

```bash
jq -s --arg since "$BUG53_START_TS" '{
  session_continuation: map(select(.event_type == "session_continuation" and .timestamp >= $since)) | length,
  run_completed: map(select(.event_type == "run_completed" and .timestamp >= $since)) | length,
  session_paused_anomaly: map(select(.event_type == "session_paused" and .timestamp >= $since)) | length,
  terminal_status: (input_filename | "from continuous-session.json")
}' .agentxchain/events.jsonl
```

Also paste:

```bash
jq '{status, runs_completed, idle_cycles}' .agentxchain/continuous-session.json
```

Required shape:
- `session_continuation` count equals `runs_completed - 1` when `runs_completed >= 2`; equals `0` when `runs_completed < 2`.
- `run_completed` count equals `runs_completed`.
- `session_paused_anomaly == 0` — a session_paused event after a clean completion is the BUG-53 regression signature; any non-zero value is a reopener.
- `continuous-session.json::status` is `idle_exit` at terminal review time for this ask. Block 1 can be inspected while running, but the closure paste should show the same current-window session eventually reached Block 2's clean idle-exit.

---

## Review Rules For Agents

Reject BUG-53 quote-back if:

- Version is lower than `2.154.7`.
- Evidence comes from a synthetic mock executor, an `agentxchain init` scratch repo without a real VISION fixture, the `cli/scripts/reproduce-bug-54.mjs` harness, or an unversioned local checkout (e.g., `cd cli && node bin/agentxchain.js …`). Closure requires shipped-package, full adapter-path evidence on a real governed project.
- Block 1 `session_continuation.payload` is missing any of the seven required keys (`session_id`, `previous_run_id`, `next_run_id`, `next_objective`, `next_intent_id`, `runs_completed`, `trigger`) OR contains additional keys beyond those seven. Additive fields require a migration plan per the BUG-53 spec and do NOT sneak in on a closure quote-back.
- Block 1 `session_continuation.payload` contains any of the concrete BUG-54 or BUG-61 diagnostic keys banned by `.planning/BUG_53_REENTRY_SPEC.md` §4/G3: `prompt_transport`, `env_snapshot`, `stdin_bytes`, `watchdog_ms`, `auto_retried_ghost`, `ghost_retry_exhausted`, `attempts_log`, `diagnostic_bundle`, `failure_type`. Cross-bug contamination on this event is a reopener.
- Block 1 shows `runs_completed < 2` — without at least one chain transition the positive case is not actually exercised. v2.150.0 tester evidence already covered `runs_completed == 0`; this ask asks for more.
- Block 1 `session_continuation.previous_run_id == session_continuation.next_run_id`, OR either id is null — the emission guard at `continuous-run.js:925` should prevent that, so a violation means the emission semantics drifted.
- Block 1 or Block 2 shows `continuous-session.json::status == "paused"` — `paused` is reserved for `isBlockedContinuousExecution(execution)` cases (open escalations, `needs_human` gates), NOT clean completion or idle-exit. A paused terminal state on this ask is the BUG-53 regression signature.
- Block 1 evidence comes from one session and Block 2 evidence comes from a different session. BUG-53 V5 closure requires a single current-window continuous session so the `session_continuation == runs_completed - 1` invariant is meaningful.
- Block 2 shows `status == "paused"`, `status == "running"` with no forward progress, or `status == "completed"`. The expected terminal for exhausted vision is `idle_exit`; `completed` proves only that `max_runs` fired.
- Block 1 or Block 2 pauses on an open escalation, `needs_human` phase gate, or BUG-52-like phase-gate loop. That evidence belongs under BUG-52 V1 first; it does not close or reopen BUG-53 because the session did not reach the clean post-completion re-entry path.
- Block 3 SUMMARY reports `session_paused_anomaly >= 1` — any `session_paused` event in the current window invalidates the closure.
- Block 3 SUMMARY's `session_continuation` count disagrees with `runs_completed - 1` (Block 1) or is non-zero when `runs_completed < 2` (Block 2).
- Any required command is replaced, paraphrased, summarized, or run without the `$BUG53_START_TS` scoping. Historical events from pre-ask sessions must not pollute the evidence.

When valid quote-back lands, update `.planning/HUMAN-ROADMAP.md` to flip BUG-53 to `- [x]` with completion date + tester-session pointer, file `DEC-BUG53-CLEAN-COMPLETION-NEVER-PAUSES-001` and `DEC-BUG53-SESSION-CONTINUATION-PAYLOAD-SHAPE-001` in `.planning/DECISIONS.md` per the spec's §7, and only then consider subsequent BUG-53-adjacent work.

---

## Why A Separate Ask

BUG-53's evidence lane is distinct from BUG-52 (V1 — phase-gate advance after `unblock`), BUG-59/BUG-54 (V2 — approval-policy coupling + adapter reliability), BUG-62 (V3 — operator-commit reconcile), and BUG-61 (V4 — ghost-turn auto-retry). BUG-53 requires a real multi-run continuous session with a VISION fixture that has enough derivable goals to force at least one auto-chain, paired with event evidence drawn from `.agentxchain/events.jsonl` and session-state evidence from `.agentxchain/continuous-session.json`. Splitting keeps each tester sitting bounded and each evidence block unambiguous. BUG-53 evidence must NOT be mixed into V4's BUG-61 ghost-retry output — different closure contracts, different review rules, different events.
