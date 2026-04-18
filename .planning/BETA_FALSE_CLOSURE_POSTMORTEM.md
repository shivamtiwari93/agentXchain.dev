## Purpose

Record why BUG-17, BUG-19, BUG-20, and BUG-21 were marked closed while the beta tester could still reproduce the defects on `v2.129.0`, and freeze the discipline changes required before the beta-fix cluster can be trusted again.

## What Went Wrong

1. We closed bugs on seam-level proof instead of operator-sequence proof.
   - Unit and narrow integration tests exercised helper functions and selected code paths.
   - They did **not** exercise the tester's real command sequence in a temp governed repo with real runtimes and real git state transitions.
2. We treated green local slices as release evidence.
   - Bugs were declared fixed when one surface passed, even though adjacent surfaces (`doctor`, `status`, `restart`, phase advance, event provenance) still disagreed.
3. We let release/doc copy outrun actual implementation.
   - Release notes and docs spoke in “fixed” language before the real end-to-end experience had been re-verified.
4. We stopped re-reading `HUMAN-ROADMAP.md`.
   - Collaboration drifted into release/features while the human had already opened a new blocker queue.

## Why The Existing Tests Missed It

- BUG-17: restart tests covered a narrower restart path than the tester's accepted-turn -> commit -> restart flow.
- BUG-19: gate truth checks did not verify same-poll recomputation across `status`, `approve-transition`, and `doctor`.
- BUG-20: intent lifecycle assertions stopped at display-level status instead of phase-crossing lifecycle proof.
- BUG-21: provenance coverage touched some bundle/history paths but not every live event emission path.
- BUG-26: doctor used shell lookup (`command -v`) while dispatch used `spawn`, so “binary exists” was never the same contract as “dispatchable runtime.”

## Required Process Changes

1. No beta bug closes without a tester-sequence regression that reproduces the operator flow in a temp governed repo.
2. The regression must be run before closure against the fresh CLI build that is actually about to ship.
3. Release notes may only claim the exact surfaces that the tester-sequence proof covered.
4. `HUMAN-ROADMAP.md` is the authoritative priority queue and must be re-read at the start of every turn, even if AGENT-TALK says the queue was previously empty.

## Evidence Surfaces Required For Closure

- tester-sequence regression file in `cli/test/beta-tester-scenarios/`
- passing test output captured after the fix
- exact CLI version + commit SHA used for the proof
- closure note containing `reproduces-on-tester-sequence: NO`

## Second-Wave False Closures (BUG-25 through BUG-30)

The beta tester's 2026-04-18 report (report #6) revealed that BUG-17, BUG-19, BUG-20, BUG-21 were reopened as BUG-27 through BUG-30, plus a new BUG-25. Investigation:

### BUG-25: `reissue-turn` runtime resolution
- **Root cause:** `reissueTurn()` at governed-state.js:2491 used `role.runtime` (raw config field) on a normalized config where the field is `runtime_id`. Every other function used the defensive `role.runtime_id || role.runtime` pattern. One-line fix.
- **Why missed:** The BUG-7 regression test used raw config objects directly, never going through `loadProjectContext` → `normalizeV4`. The raw config has `role.runtime`, so the test passed. The real CLI always normalizes.

### BUG-27 (REOPEN of BUG-17): restart ghost turn
- **Finding:** The BUG-17 fix (Turn 139) IS in the current codebase. `restart.js` calls `writeDispatchBundle` after assignment. The tester tested on v2.129.0, which predated the fix.
- **Why false-closed:** BUG-17 was marked fixed and a regression test was written, but the fix was committed AFTER v2.129.0 was released. The tester's report was accurate for v2.129.0.

### BUG-28 (REOPEN of BUG-19): stale gate state
- **Finding:** The Turn 139 acceptance flow re-evaluates phase exit gates after acceptance. Content-based gate failures ARE cleared by the gate re-evaluation, not by the reconciliation code (which only handles file existence).
- **Why false-closed:** Same timing issue as BUG-27 — fix was in codebase but not in v2.129.0.

### BUG-29 (REOPEN of BUG-20): satisfied intents still pending
- **Finding:** Intent auto-completion on acceptance works when `intake_context.intent_id` is bound to the turn. This requires the turn to be assigned via `consumeNextApprovedIntent` or with explicit `intakeContext`.
- **Why false-closed:** The BUG-20 test manually set intent state. The real gap (multi-intent scenarios, phase-crossing) wasn't covered. Turn 139/140 fixes addressed this.

### BUG-30 (REOPEN of BUG-21): intent_id null in events
- **Finding:** `assignGovernedTurn` emits `turn_dispatched` with `intent_id` from `options.intakeContext`. This works when intakeContext is provided. The Turn 139 fix to `restart.js` (consuming approved intents) ensures intakeContext flows through.
- **Why false-closed:** The regression test checked turn objects, not event records.

### Common Pattern
All false closures share the same root cause: **tests exercised narrow API seams with hand-crafted state, not the actual operator command sequence with normalized configs and real git operations.** The fix: `cli/test/beta-tester-scenarios/` directory with per-bug E2E tests using real CLI commands, scaffolded projects, and normalized config paths.

## Open Questions

- Whether beta-bug scenario tests should become a separately named CI job with an explicit release gate instead of being folded into the general `npm test` run.
- Whether release-note generation should hard-fail if a claimed bug fix lacks a linked tester-sequence regression file.
