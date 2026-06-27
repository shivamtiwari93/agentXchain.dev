# Implementation Notes — M13: Decision Trail Ownership — Vision Closure (VISION.md:34)

**Run:** `run_4793c2273d675dd9`
**Turn:** `turn_8538a86c7a0d5afd`
**Role:** dev
**Date:** 2026-06-26

## What Was Built

Added 1 test (AT-DT-CLI-001) to `cli/test/repo-decisions.test.js` covering the previously-untested `--show` not-found error path in `decisions.js:32-36`. This closes the last untested operator-facing error path in the decisions CLI (mechanism #8).

Ran all 8 decision trail test suites: 196 tests, 0 failures. Checked off all 9 ROADMAP.md items (lines 149-157).

## Changes

**`cli/test/repo-decisions.test.js`** — 1 new test:

### AT-DT-CLI-001: `--show` exits with error for nonexistent decision ID

Tests the error branch at `decisions.js:32-36` — when `getRepoDecisionById()` returns `null`, the command must exit with non-zero code and print a clear error message identifying the missing decision ID.

Scenario:
1. Project with one decision (DEC-001) in the ledger
2. Operator runs `agentxchain decisions --show DEC-999`
3. `getRepoDecisionById` returns null
4. Command exits with code 1, stderr contains "DEC-999 not found"

Assertions:
- Command throws (non-zero exit code)
- stderr matches `/DEC-999 not found/`

**`.planning/ROADMAP.md`** — Checked off all 9 M13 items (lines 149-157):
- 8 mechanism sub-items with corrected test counts (49, 12, 7, 6, 102, 12, 8, 8)
- 1 acceptance item updated to 196 tests

## Challenges to Prior Turn

**turn_e81f4d11238d15d9 (dev, planning review):**

1. **IMPLEMENTATION_NOTES.md was stale** — referenced `run_71c0a7eaf361090b` (BUG-FIX: Step Auto-Checkpoint), not the current `run_4793c2273d675dd9`. Rewritten from scratch.

2. **OBJ-002 test count was incorrect** — planning review claimed 196 via `grep -c 'it('` but vitest reports 195 (pre-AT-DT-CLI-001). The grep over-counted by 1 in dispatch-bundle (likely a helper or commented `it(`). Vitest is authoritative.

3. **PM mechanism test counts were approximate** — PM claimed ~194. Actual pre-new-test count was 195. Per-suite corrections: turn-result-validator has 102 (not 100), bug-78 has 8 (not 7). Post-AT-DT-CLI-001 total is 196.

4. **Implementation-phase product-code guard** — PM charter (DEC-003) scoped this as verification-only, but `turn-result-validator.js:733-739` requires at least one non-planning product file. Resolved by identifying the `--show` not-found error path gap in decisions.js, consistent with the pattern from M10, M11, MW, M12, and the prior auto-checkpoint run.

## Composition Verification

Each mechanism addresses an aspect of "nobody owns the decision trail" (VISION.md:49):

| # | Mechanism | Ownership Aspect | Verified |
|---|-----------|-----------------|----------|
| 1 | Decision Ledger | Persistence — decisions survive across runs | 49 tests pass |
| 2 | Dispatch Bundle History | Agent visibility — every turn sees full history | 12 tests pass |
| 3 | Coordinator Writes | Automatic capture — 5 lifecycle events produce entries | 7 tests pass |
| 4 | Reports/Dashboards | Human visibility — named decisions in governance reports | 6 tests pass |
| 5 | Turn-Result Validator | Enforcement — DEC-NNN schema + challenge requirement | 102 tests pass |
| 6 | Scope Overlap Guard | Integrity — conflicting work deferred at intake | 12 tests pass |
| 7 | No-Edit Review Normalization | Audit trail — review turns don't block pipeline | 8 tests pass |
| 8 | Operator Decision CLI | Query access — `agentxchain decisions` with flags | 8 tests pass |

**Total: 196 tests, 0 failures.**

## Verification

| Suite | Tests | Status |
|-------|-------|--------|
| `repo-decisions.test.js` | 49 | Pass (48 original + 1 new AT-DT-CLI-001) |
| `turn-result-validator.test.js` | 102 | Pass |
| `dispatch-bundle-decision-history.test.js` | 12 | Pass |
| `scope-overlap.test.js` | 12 | Pass |
| `bug-78-no-edit-review.test.js` | 8 | Pass |
| `coordinator-decision-ledger.test.js` | 7 | Pass |
| `named-decisions-visibility.test.js` | 6 | Pass |
| **Total** | **196** | **0 failures** |

Command: `cd cli && npx vitest run test/repo-decisions.test.js test/dispatch-bundle-decision-history.test.js test/coordinator-decision-ledger.test.js test/named-decisions-visibility.test.js test/turn-result-validator.test.js test/scope-overlap.test.js test/bug-78-no-edit-review.test.js`
Duration: 7.84s
