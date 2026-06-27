# Release Notes — M13: Decision Trail Ownership — Vision Closure (VISION.md:34)

**Run:** run_4793c2273d675dd9
**Turn:** turn_bab59d2ad8d0e45e (QA)
**Date:** 2026-06-26

## Summary

Formal closure of ROADMAP.md M13: "Decision Trail Ownership — Vision Closure (VISION.md:34)." Eight mechanisms delivered across prior milestones (M1, M3, MW, M10) compose to fully address the VISION.md:49 coordination failure: "nobody owns the decision trail." This run verified the composition (196 tests, 0 failures) and added one test (AT-DT-CLI-001) covering a previously-untested CLI error path.

## What Changed (This Run)

### New Test: AT-DT-CLI-001 in `cli/test/repo-decisions.test.js`

Tests the `--show` not-found error path at `decisions.js:32-36` — when `getRepoDecisionById()` returns null for a nonexistent decision ID, the command exits with non-zero code and prints a clear error message.

Assertions:
- Command throws (non-zero exit code)
- stderr matches `/DEC-999 not found/`

### ROADMAP.md M13 Fully Closed

All 9 items (lines 149-157) checked off:
- 8 mechanism sub-items with verified test counts
- 1 acceptance item updated to 196 tests, 0 failures

## 8 Mechanisms Composing Decision Trail Ownership

| # | Mechanism | What It Provides |
|---|-----------|-----------------|
| 1 | Decision Ledger | Cross-run persistent storage with 12 CRUD+query exports |
| 2 | Dispatch Bundle History | Every dispatched turn sees full decision history in context |
| 3 | Coordinator Writes | 5 lifecycle events (init, dispatch, phase-transition, completion, recovery) auto-produce entries |
| 4 | Reports/Dashboards | Named decisions rendered in governance reports with per-repo breakdowns |
| 5 | Turn-Result Validator | DEC-NNN schema enforcement + challenge requirement on every turn |
| 6 | Scope Overlap Guard | Intake-level guard defers conflicting work; `--force-scope` override |
| 7 | No-Edit Review Normalization | BUG-78 Rule 0a preserves audit trail for review-only turns |
| 8 | Operator Decision CLI | `agentxchain decisions` with `--all`, `--show`, `--json` for operator query access |

## User Impact

- **Vision closure**: VISION.md:49 "nobody owns the decision trail" is now fully addressed. Operators and agents have persistent, enforced, queryable decision trails across runs, phases, and roles.
- **Improved CLI coverage**: AT-DT-CLI-001 covers the `--show` not-found error path, completing operator-facing error handling coverage for the decisions command.
- **No breaking changes**: One test file modified, no source module changes.

## Verification Summary

QA independently ran all 8 decision trail test suites:
- **196 tests, 0 failures** (exit code 0, 8.32s)
- 5/5 acceptance criteria pass
- 5/5 architecture invariants confirmed
- 8/8 mechanisms verified as addressing distinct ownership dimensions
- ROADMAP.md M13 (lines 149-157) fully closed
