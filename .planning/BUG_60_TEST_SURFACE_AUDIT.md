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

## Open Items For The Real Research Turn

- Decide whether the PM idle-expansion path consumes intake lifecycle helpers directly or runs through a normal governed PM turn.
- Decide the exact observable event names and status strings for `vision_exhausted` and `vision_expansion_exhausted`.
- Decide whether perpetual PM expansion emits `session_continuation`, a new event type, or both.
- Decide how BUG-59 approval-policy ledger rows are asserted in the perpetual beta scenario once real tester quote-back confirms the shipped gate behavior.
