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

## Open Questions

- Whether beta-bug scenario tests should become a separately named CI job with an explicit release gate instead of being folded into the general `npm test` run.
- Whether release-note generation should hard-fail if a claimed bug fix lacks a linked tester-sequence regression file.
