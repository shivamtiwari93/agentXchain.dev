# BUG-60 Test Surface Audit

**Status:** Static inventory only. This is allowed pre-closure work under the narrowed `DEC-BUG59-CLOSURE-GATE-TESTER-QUOTEBACK-001`: no `cli/src/lib/` changes, no Option A/B selection, no schema decision, and no PM idle-expansion prompt text.

**Purpose:** Identify the tests that already protect bounded continuous mode and the gaps BUG-60 must close once tester quote-back unlocks implementation planning.

## Current Bounded-Mode Assertions

| Test surface | Current assertion | BUG-60 implication |
|---|---|---|
| `cli/test/vision-reader.test.js:117-155` | `deriveVisionCandidates()` derives candidates from unaddressed `VISION.md`, returns zero candidates when completed intent signals cover the goal, and fails clearly when `VISION.md` is missing or empty. | Keep default `VISION.md` behavior. Add separate tests for any ROADMAP/SYSTEM_SPEC candidate reader instead of weakening these baseline assertions. |
| `cli/test/continuous-run.test.js:95-124` | `resolveContinuousOptions()` knows `enabled`, `visionPath`, `maxRuns`, `pollSeconds`, `maxIdleCycles`, and `triageApproval`; no idle-policy fields are asserted. | Any future `on_idle` / `max_idle_expansions` fields need default and config-override assertions here. |
| `cli/test/continuous-run.test.js:161-211` | `seedFromVision()` writes a vision-provenance intent, auto-approves it by default, leaves it triaged when `triage_approval: human`, and returns idle when goals are addressed. | If perpetual mode uses the intake pipeline, add a sibling seed path or assertion for `vision_idle_expansion` provenance without changing `vision_scan` semantics. |
| `cli/test/continuous-run.test.js:214-305` | `executeContinuousRun()` chains multiple vision goals and exits after max idle cycles when all goals are addressed; the idle test expects no executor call and the "All vision goals appear addressed" log. | Default `on_idle: exit` must keep this exact behavior. Perpetual mode needs a new test path, not a rewrite that erases bounded semantics. |
| `cli/test/schedule-continuous.test.js:820-849` | `advanceContinuousRunOnce()` with `idle_cycles >= max_idle_cycles` returns `idle_exit` and sets `session.status = completed`. | This is the narrow branch where `on_idle: perpetual` will diverge. Existing assertion should remain for default/exit policy. Add a separate perpetual-policy row after schema exists. |
| `cli/test/claim-reality-preflight.test.js:4143-4185` | Release gate verifies BUG-53 scenario coverage, packed `continuous-run.js`, `session_continuation` payload fields, and that `session.status = 'paused'` only appears in blocked branches. | BUG-60 must extend the release gate to require the new beta scenario and packed perpetual-mode implementation. It should keep the paused-status guard. |
| `cli/test/claim-reality-preflight.test.js:4188-4324` | Packed in-process continuous proof auto-chains two vision-derived runs and emits one `session_continuation` event. | Reuse the pattern for a lower-level perpetual proof only if the CLI-chain test also exists; this alone is insufficient under Rule #12. |
| `cli/test/claim-reality-preflight.test.js:4326-4526` | Packed CLI proof reaches bounded `idle_exit` after one completed run, emits zero `session_continuation` events after exhaustion, and records `session.status = completed`. | This becomes the regression guard that `on_idle: exit` is backward-compatible after perpetual mode ships. Do not mutate it into a perpetual test. |
| `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js` | Source-tree CLI and in-process scenarios prove continuous mode auto-chains existing vision candidates, never pauses on clean completion, and reaches bounded idle exit. | BUG-60 should add a new `bug-60-perpetual-idle-expansion.test.js`; it should not overload BUG-53 with a different product contract. |
| `cli/test/continuous-3run-proof-content.test.js` | Checked-in live proof evidence records three vision-scan runs, session completion, sanitized paths, and docs linkage. | Future perpetual evidence should be separate or clearly labeled so "vision_scan three-run proof" is not confused with "PM idle-expansion proof." |

## Gaps To Close After Tester Quote-Back

1. No current test asserts config parsing for `on_idle`, `on_idle_perpetual`, or `max_idle_expansions`.
2. No current test accepts `vision_idle_expansion` as an intake source; `continuous-run.test.js:407-413` only guards `vision_scan`.
3. No current test covers "bounded idle queue empty, then dispatch PM idle-expansion, then create a new executable intent."
4. No current test covers malformed PM idle-expansion output or a `vision_exhausted` declaration.
5. No current test proves that the existing `per_session_max_usd` block fires before a perpetual-mode PM dispatch can spend again.
6. No current packed-release gate requires `bug-60-perpetual-idle-expansion.test.js`.

## Non-Negotiable Test Boundary

The BUG-60 positive/negative beta scenario must be a command-chain test using the packaged or source CLI entrypoint, matching the roadmap's Rule #12 requirement. Function-level seams such as `executeContinuousRun()` can support faster coverage, but they cannot be the closure proof for the tester-reported full-auto behavior.

## Static Test Harness Inventory

This inventory is mechanical only. It does not choose Option A vs. Option B, a schema, event names, or PM prompt text.

| Existing harness/helper | Location | What it gives BUG-60 | Constraint |
|---|---|---|---|
| Source-tree continuous unit scaffold | `cli/test/continuous-run.test.js:createTmpProject()` | Minimal governed config, state files, `writeVision()`, `writeIntent()`, fast `executeContinuousRun()` loops. | Helpers are file-local, not exported. Reuse the pattern, not the function. Good for default `on_idle: exit` and resolver tests, not sufficient for Rule #12 closure. |
| Source-tree schedule primitive scaffold | `cli/test/schedule-continuous.test.js:makeTmpDir()` / `writeConfig()` / `writeState()` / `writeScheduleState()` | Direct `advanceContinuousRunOnce()` coverage for the scheduler daemon path. | This is the only existing test surface that naturally exercises the scheduler single-step caller. BUG-60 must not prove only the main loop if the perpetual branch is reachable from scheduler ticks. |
| Budget enforcement scaffold | `cli/test/continuous-budget.test.js:createTmpProject()` | Existing `per_session_max_usd` assertions and a direct pre-check test around `advanceContinuousRunOnce()`. | BUG-60 should add a budget-before-PM-expansion assertion near this surface or a sibling test, because this file already owns the continuous budget contract. |
| BUG-53 source CLI scenario | `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js:createCliProject()` / `runContinuousCli()` | Best current operator-chain pattern: fake local CLI agent, real `bin/agentxchain.js run --continuous`, git-clean temp repo, event assertions, idle-exit CLI proof. | Helpers are local to the BUG-53 file. BUG-60 should create its own beta scenario rather than importing from BUG-53, but it should mirror this command-chain shape. |
| BUG-53 in-process scenario | `cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js:makeSuccessExecutor()` | Fast `executeContinuousRun()` proof for multi-run state/event behavior. | Supportive only. It cannot replace the CLI-chain scenario because it bypasses command parsing and runtime dispatch wiring. |
| Claim-reality scenario file gate | `cli/test/claim-reality-preflight.test.js:4143-4185` | Existing pattern requiring a beta scenario file to exist and asserting it shells through the real CLI chain. | BUG-60 needs an analogous release-gate row that fails if `bug-60-perpetual-idle-expansion.test.js` is missing or only uses function-level seams. |
| Claim-reality packed module proof | `cli/test/claim-reality-preflight.test.js:4188-4324` | Extracts npm pack output and imports packed `continuous-run.js` to prove release tarball behavior. | Useful as a second proof surface after source tests pass. Still not enough alone because it bypasses packed `bin/agentxchain.js`. |
| Claim-reality packed CLI proof | `cli/test/claim-reality-preflight.test.js:4326-4526` | Spawns extracted tarball `bin/agentxchain.js run --continuous` and asserts bounded idle-exit operator output. | BUG-60 should add a packed CLI proof for perpetual mode, not mutate this bounded `idle_exit` row. |
| Run-event registry tests | `cli/test/run-events.test.js`, `cli/test/current-release-surface.test.js` | Guard that new event names are registered and present in release surfaces. | Only relevant after the architecture chooses event names. Static audit can note the surface, but should not pre-name events. |

## Harness Gaps

1. There is no shared `createTempRepo()` helper for continuous CLI tests. Each file rolls its own temp repo and cleanup. A BUG-60 scenario should stay local initially to avoid a broad test-helper refactor while the behavior is still unsettled.
2. There is no reusable fake PM idle-expansion runtime. BUG-60 will need one scenario-local fake runtime that can emit both a valid new-intent artifact and a malformed-output artifact.
3. There is no existing test harness that asserts scheduler-daemon behavior for terminal idle policy through the real `schedule` CLI command. The current scheduler coverage is `advanceContinuousRunOnce()` level. The real research turn must decide whether a function-level scheduler proof is enough or whether a CLI scheduler scenario is required.
4. There is no packed release-gate row for future `on_idle` config parsing. Once schema exists, the release gate should check both source scenario presence and packed CLI behavior so the published package cannot silently drop perpetual mode.

## Adversarial Review Of Code-Audit Appendices

Claude's Appendix A product-code caller graph is materially correct under its stated scope. `grep -RIn` finds additional hits for `advanceContinuousRunOnce`, `executeContinuousRun`, `deriveVisionCandidates`, and `session_continuation` in tests and docs, but no extra product-code caller that changes BUG-60's implementation surface. The important testing implication is that `session_continuation` already has several release and docs assertions, so adding a sibling event later will require updating event-registry and release-surface tests deliberately.

## Open Items For The Real Research Turn

- Decide whether the PM idle-expansion path consumes intake lifecycle helpers directly or runs through a normal governed PM turn.
- Decide the exact observable event names and status strings for `vision_exhausted` and `vision_expansion_exhausted`.
- Decide whether perpetual PM expansion emits `session_continuation`, a new event type, or both.
- Decide how BUG-59 approval-policy ledger rows are asserted in the perpetual beta scenario once real tester quote-back confirms the shipped gate behavior.
