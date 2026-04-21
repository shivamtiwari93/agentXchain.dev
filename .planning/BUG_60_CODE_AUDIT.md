# BUG-60 Code Audit (Pre-work Turn A Step 1)

**Status:** Partial — static file:line verification only. No Option A/B decision, no PM prompt text, no `cli/src/lib/` modifications. Written under the narrowed interpretation of DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001 (see Turn 153 AGENT-TALK).

**Purpose:** Bank the factual audit that does not depend on BUG-59's tester-verified behavior. If BUG-59 proves fixed on `tusq.dev`, the real BUG-60-RESEARCH-CLAUDE turn extends this doc. If BUG-59 fails on `tusq.dev`, this audit still reflects current code and is reusable after the root cause is re-analyzed.

**Scope restriction (self-imposed for this turn):** no architectural recommendations, no dispatch-path selection, no schema proposals. Every claim below is a mechanical check against HEAD.

## Verified — roadmap audit entries match live code

HUMAN-ROADMAP.md BUG-60 section cites a current-behavior audit table. Each row re-checked against `main` (commit `08fc5556`):

| Surface | Roadmap cite | Live match | Notes |
|---|---|---|---|
| Idle cycle counter increment | `cli/src/lib/continuous-run.js:468-469` | ✅ exact | `session.idle_cycles += 1; log('Idle cycle N/M — no derivable work from vision.')` |
| Terminal idle-exit check | `cli/src/lib/continuous-run.js:348-351` | ✅ exact | Sets `session.status = 'completed'`, returns `{ status: 'idle_exit', action: 'max_idle_reached', stop_reason: 'idle_exit' }` |
| User-facing idle-exit string | `cli/src/lib/continuous-run.js:94-96` | ✅ exact | `All vision goals appear addressed (${maxIdleCycles} consecutive idle cycles). Stopping.` |
| `deriveVisionCandidates` | `cli/src/lib/vision-reader.js:176-217` | ✅ exact | Reads VISION.md only, compares against `loadCompletedIntentSignals()` + `loadActiveIntentSignals()`, returns `{ ok, candidates: [{section, goal, priority}], error? }` |
| Budget cap categorical block | `cli/src/lib/continuous-run.js:354-362` | ✅ exact | Terminates with `status: 'completed', stop_reason: 'session_budget'`, sets `session.budget_exhausted = true` |
| `normalizeContinuousConfig` | `cli/src/lib/normalized-config.js:1279-1292` | ✅ exact | Fields: `enabled, vision_path, max_runs, max_idle_cycles, triage_approval, per_session_max_usd` |
| `resolveContinuousOptions` runtime options | `cli/src/lib/continuous-run.js:302-317` | ✅ exact | Adds `poll_seconds, cooldown_seconds, auto_checkpoint` on top of the config-normalized set |
| `recordEvent` entry point | `cli/src/lib/intake.js:328-387` | ✅ exact | Dedup via `computeDedupKey(source, signal)`; writes both event and auto-created intent |
| `VALID_SOURCES` enum | `cli/src/lib/intake.js:32` | ✅ exact | `['manual', 'ci_failure', 'git_ref_change', 'schedule', 'vision_scan']` |
| `renderPrompt` prompt-override mechanism | `cli/src/lib/dispatch-bundle.js:184-205` | ✅ exact | `config.prompts[roleId]` resolves to a file path, load result becomes `customPrompt` |
| Role mandate rendering | `cli/src/lib/dispatch-bundle.js:221-225` | ✅ exact | Pulls `role.mandate` straight from config; no per-dispatch override point today |
| `.agentxchain/prompts/pm.md` scaffold | claimed canonical | ✅ exists | File present at repo root; peer prompts `dev.md`, `qa.md`, `eng_director.md` also present |

## Discrepancies — roadmap cites that need sharpening (non-blocking)

1. **`advanceContinuousRunOnce` line range is broader than cited.** Roadmap says `continuous-run.js:337-486`. Live: function declared at `:337`, closes at `:646`. The 337-486 range the roadmap cites covers the idle/budget/vision-scan entry section (which is where BUG-60's perpetual branch lands), but it is not the function boundary. The research turn should cite `:337-646` when the claim is "the function owns the idle→exit decision" vs the narrower `:337-486` when the claim is "the idle-exit branch lives here."
2. **"Schema at `intake.js:365-382`" is the intent schema, not the event schema.** Roadmap attaches this line range to the `recordEvent` discussion but `:365-382` is the auto-created intent shape (`intent_id`, `status: 'detected'`, `requires_human_start: true`, etc.). The event shape is at `:348-359`. If the BUG-60 dispatch path records a new-sourced event, the target schema is `:348-359`; if it needs to tune the auto-created intent, the target is `:365-382`. Research turn should split the citation.

## New findings worth capturing before the real research turn

1. **`recordEvent` always creates a `detected` intent with `requires_human_start: true`.** `intake.js:375` sets `requires_human_start: true` unconditionally on the auto-created intent. Option A (intake-pipeline dispatch) must either:
   - override `requires_human_start` on the synthesized intent before it reaches `triageIntent`/`approveIntent`, OR
   - have the continuous loop call the lifecycle methods (`triageIntent → approveIntent → planIntent → startIntent`) with the new source's implied policy baked in.
   This is a substantive design point the roadmap's Option A sketch did not call out. It does not decide Option A vs Option B — but anyone picking Option A needs to name the override path.
2. **No per-dispatch mandate override exists today.** `dispatch-bundle.js:221-225` renders `role.mandate` straight from config with no per-turn override hook. The `config.prompts[roleId]` file-swap at `:184-205` IS the only override seam. If the research turn wants per-dispatch mandate modulation (e.g., inject "you are in idle-expansion mode" without swapping the whole prompt file), a new seam is required. Leaving this open for the real research turn; not proposing a fix here.
3. **`on_idle` / `continuous_policy` string is absent from both `cli/src/lib/` and `cli/test/`.** Roadmap's greenfield claim holds. No legacy partial implementation to respect.
4. **`.agentxchain/prompts/pm.md` is 1,991 bytes.** If the BUG-60 research turn proposes a `.agentxchain/prompts/pm-idle-expansion.md` template, it can sit alongside the existing scaffold without schema changes.

## What this audit does NOT do (and why)

- Does NOT choose Option A vs Option B. The choice is an architectural commitment and is blocked by DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001 (as narrowed on Turn 154) regardless of BUG-59 outcome. For clarity: Option B's governance-bypass risk is independent of BUG-59 — it does not become acceptable if BUG-59 fails on `tusq.dev`. What BUG-59's tester quote-back unblocks is whether the shipped gate-closure contract can be relied on by a perpetual-mode chain; it does NOT retroactively make direct special-case dispatch (Option B) safer. A perpetual-mode chain that bypasses governance is worse on a working BUG-59 fix (because it voluntarily gives up the policy ledger that now works) and also worse on a failed BUG-59 fix (because it stacks an autonomy feature on an unverified substrate). Option B's downsides are monotonic.
- Does NOT draft the PM idle-expansion prompt. Prompt text is an architectural commitment.
- Does NOT trace the full perpetual-mode scenario. Scenario tracing is Step 4 of Pre-work Turn A and again depends on BUG-59's tester-verified state.
- Does NOT answer the four specific research questions at HUMAN-ROADMAP.md:391-395. Each of the four has a BUG-59-dependent branch.
- Does NOT propose or ship any `cli/src/lib/` change. Explicitly disallowed by HUMAN-ROADMAP.md:421.

## Resume points

When tester evidence on v2.151.0 lands and BUG-59 is tester-verified (per DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001), the real BUG-60-RESEARCH-CLAUDE turn:

1. Extends this doc with the Option A/B decision and rationale.
2. Drafts the PM idle-expansion prompt.
3. Traces the full perpetual-mode scenario end-to-end.
4. Answers HUMAN-ROADMAP.md:391-395 questions in writing.
5. Maps every test that needs updating.

If BUG-59 fails on `tusq.dev`, the research turn re-scopes around what actually shipped vs. what the roadmap assumed.

## Appendix A — Caller graph for the surfaces BUG-60 will touch (static, no future branch)

Every callsite below is HEAD (`08fc5556`) and describes **only** what ships today. No perpetual-mode speculation.

| Symbol | Declared at | Callers today | Call shape |
|---|---|---|---|
| `advanceContinuousRunOnce` | `cli/src/lib/continuous-run.js:337` | `cli/src/lib/continuous-run.js:693` (main loop); `cli/src/commands/schedule.js:479` (scheduler daemon single-step) | Two, both async-awaited. Scheduler calls it exactly once per tick; main loop calls it in a while(true) with sleep between iterations. |
| `executeContinuousRun` | `cli/src/lib/continuous-run.js:661` | `cli/src/commands/run.js:80` | One, only the `run --continuous` CLI entry point. |
| `isBlockedContinuousExecution` | `cli/src/lib/continuous-run.js:114` | `cli/src/lib/continuous-run.js:408` (resume-after-unblock branch), `:575` (post-execute branch) | Two, both inside `advanceContinuousRunOnce`. No external caller. |
| `seedFromVision` | `cli/src/lib/continuous-run.js:224` | `cli/src/lib/continuous-run.js:456` (single call inside the idle → vision-derive branch) | One, synchronous. No test-only or external caller. |
| `deriveVisionCandidates` | `cli/src/lib/vision-reader.js:176` | `cli/src/lib/continuous-run.js:15` import → `:225` via `seedFromVision` | One caller path in product code. Vision-reader tests import directly. |
| `session_continuation` event | emitted at `cli/src/lib/continuous-run.js:514` | consumed by `cli/src/lib/recent-event-summary.js:82` (summary formatter); registered in `cli/src/lib/run-events.js:45` enum | Single emit site. Consumer is summary-only; no state mutation depends on it. |

**Implications for the real research turn (not decisions, just factual implications):**

- Any perpetual-mode branch added at `advanceContinuousRunOnce` is observable by both the main continuous loop AND the scheduler daemon. The research turn must confirm both entry points reach the branch with the same semantics, or pick one and gate the other.
- `isBlockedContinuousExecution` is private; a perpetual-mode "PM-expansion produced a blocked state" case does not need a new public predicate — it can reuse this one if the branch sits inside `advanceContinuousRunOnce`.
- `session_continuation`'s single emit site means the research turn has an existing precedent for the operator-visible audit event. Whether the PM-expansion path reuses this event, adds a sibling, or both, is a research-turn decision — but the mechanical surface (one producer, one summary consumer, one enum entry) is small and local.
- `deriveVisionCandidates`'s single product caller means extending the reader to read ROADMAP.md/SYSTEM_SPEC.md can happen either by widening the existing function or by adding a sibling. The research turn chooses; the caller-graph does not force either shape.

## Appendix B — Mechanical trace of today's bounded-mode idle exit (no future branch)

Starting state (facts, not hypothesis): continuous session has been running, one run completed cleanly, the intake queue for `session.current_run_id` returns no dispatchable intent, and vision candidates have been exhausted.

1. `executeContinuousRun` (`continuous-run.js:661`) enters its while loop and calls `advanceContinuousRunOnce` (`:693`).
2. `advanceContinuousRunOnce` (`:337`) checks terminal conditions:
   - `session.runs_completed >= contOpts.maxRuns` → false (one run completed, limit > 1).
   - `session.idle_cycles >= contOpts.maxIdleCycles` → false on the first idle polling after completion (idle_cycles is 0 immediately after the last seed).
   - Budget cap → false (within limit).
3. `reconcileContinuousStartupState` runs (`:364`); no crash-recovery adjustment needed for this scenario.
4. Paused-session guard at `:370` → false; `session.status` is `running`.
5. Vision-file existence check at `:439` → true.
6. `findNextDispatchableIntent(root, { run_id: session.current_run_id })` at `:446` → `queued.ok === false` because the completed run retired its intent and no new one exists in the current run's scope.
7. `seedFromVision` at `:456` → returns `{ ok: true, idle: true }` because `deriveVisionCandidates` returned zero new candidates (all vision goals covered by `loadCompletedIntentSignals` + `loadActiveIntentSignals`).
8. Branch at `:467`: `seeded.idle === true` → `session.idle_cycles += 1`, log "Idle cycle N/M — no derivable work from vision.", `writeContinuousSession`, return `{ ok: true, status: 'running', action: 'no_work_found' }`.
9. Main loop in `executeContinuousRun` sees `status === 'running'` and sleeps for `pollSeconds`.
10. Steps 1–9 repeat. Each iteration increments `idle_cycles` by one.
11. Eventually `session.idle_cycles >= contOpts.maxIdleCycles` at step 2 → `session.status = 'completed'`, return `{ ok: true, status: 'idle_exit', action: 'max_idle_reached', stop_reason: 'idle_exit' }`.
12. Main loop sees `status === 'idle_exit'`, prints the user-facing message at `:94-96` ("All vision goals appear addressed…"), and exits.

**Observed final state:** `session.status = 'completed'`, `session.idle_cycles = maxIdleCycles`, `session.runs_completed` unchanged from its post-run value, `session.budget_exhausted` unset. No `session_continuation` event is emitted for this tick (the emit guard at `:513` requires `previousRunId !== preparedIntent.run_id`, and no `preparedIntent` exists in the idle branch).

**This trace is what BUG-60 changes the shape of.** It intentionally stops before any "and then the perpetual branch…" step — that branch does not exist in HEAD, and speculation about its behavior is outside the narrowed DEC scope. The trace above is the "before" half of the comparison the research turn will eventually complete; it is safe to bank because it describes shipped code, not the fix.

## Appendix C — `session.status` vocabulary inventory

Static grep across `cli/src/lib/continuous-run.js` for `session.status = '<value>'`:

| Value | Assigned at | Meaning today |
|---|---|---|
| `'running'` | `:387`, `:533` | Session is actively driving a run or ready to poll again. |
| `'paused'` | `:410`, `:584` | A run hit a `blocked` governed state; operator must `unblock`. |
| `'stopped'` | `:601`, `:716` | Run completed with `stop_reason: 'caller_stopped'`; also assigned by the main loop on operator-signal exit paths. |
| `'failed'` | `:400`, `:426`, `:440`, `:462`, `:499`, `:545`, `:580`, `:613`, `:633` | Unrecoverable error; session will not be retried automatically. |
| `'completed'` | `:343`, `:349`, `:357` | Terminal success — hit max_runs, max_idle_cycles, or session budget. |

**No `'idle_exit'` status** — idle exit is reported via the step return-shape `status` field, not the persisted `session.status`. Persisted status in that case is `'completed'`. The research turn must preserve this distinction if it adds a perpetual-mode terminal status (e.g., `'vision_exhausted'`): the step-return status vocabulary and the session.status vocabulary are not the same, and conflating them would break `cli/test/claim-reality-preflight.test.js:4326-4526` which asserts `session.status === 'completed'` at bounded idle exit.

## Appendix D — What "independent of tester quote-back" means for this audit

Every claim in this document checks code that is already merged, already shipped in `agentxchain@2.151.0`, and already running on any tester machine that installed v2.151.0. None of the claims assume BUG-59 works correctly on `tusq.dev` — they describe the mechanical structure of the continuous loop, the intake lifecycle entry point, and the prompt-override seam, all of which are upstream of BUG-59's approval-policy coupling.

If BUG-59 proves broken on `tusq.dev`, the facts in Appendices A, B, C, and the main body remain true. The research-turn *conclusions* that depend on BUG-59 (Option A vs Option B architectural call, PM-idle-expansion prompt text, the four questions at HUMAN-ROADMAP.md:391-395) are explicitly NOT in this document.
