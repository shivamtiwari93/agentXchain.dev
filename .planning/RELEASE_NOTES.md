# Release Notes

## User Impact

This is a housekeeping-only release with no runtime behavior changes. The BUG-115 ghost auto-retry session consistency fix shipped in the previous run (`run_aeb78d7979d66c0a`) and remains verified:

- **Session checkpoint consistency (Bug A):** `clearGhostBlockerAfterReissue()` writes `writeSessionCheckpoint(root, nextState, 'blocker_cleared')` so `session.json` correctly reflects `run_status: 'active'` after ghost blocker clearing.
- **Loop resilience (Bug B):** `isGovernedRunStillActiveForSession()` guard prevents premature loop exit when the governed run is still active.
- **ROADMAP.md BUG-FIX items 54-57** are all checked off with run evidence annotations.

The only code change in this run is a test tightening: the BUG-115 checkpoint regression now additionally asserts that the recovered session checkpoint carries the correct `phase` and `last_turn_id` after ghost blocker clearing.

## Verification Summary

- 441 tests across 9 suites independently verified by QA, 0 failures
- BUG-115 implementation markers confirmed at continuous-run.js lines 640, 644, 2579
- ROADMAP.md BUG-FIX items 54-57 independently confirmed as checked off
- Dev's `phase` and `last_turn_id` assertions trace correctly through the `writeSessionCheckpoint` derivation chain
- All AGENT-TALK guard tests pass (8/8)
- No whitespace issues in changed files (`git diff --check` clean)
