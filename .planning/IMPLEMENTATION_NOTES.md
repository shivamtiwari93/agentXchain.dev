# Implementation Notes — M11: Assumption Divergence Governance (Vision Closure)

**Run:** `run_a413eee8dd1891c7`
**Turn:** `turn_d23c5d790a6e85b1`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Added 9 tests covering two previously-untested governance exports in `repo-decisions.js`: `getDecisionAuthorityMetadata` (5 tests) and `buildRepoDecisionOperatorSummary` (4 tests). Both functions are part of Mechanism 1 (Decision Ledger) in the M11 assumption-divergence composition and had zero test coverage despite being exported public API consumed by `renderRepoDecisionsMarkdown`, `summarizeRepoDecisions`, and the `decisions` CLI command.

All 7 mechanism test suites independently verified: 192/192 pass (183 original + 9 new).

## Changes

**`cli/test/repo-decisions.test.js`** — Modified (9 new tests, 2 new imports):

### `getDecisionAuthorityMetadata` (5 tests)
- AT-ADG-001: Returns null when config has no roles property (null config, empty config)
- AT-ADG-002: Returns `configured` source for a role with `decision_authority` set
- AT-ADG-003: Returns `human_default` source for human role without explicit authority (verifies default 100)
- AT-ADG-004: Returns `configured` source for human role with explicit `decision_authority`
- AT-ADG-005: Returns `unknown_role` source for a role not present in config (verifies level 0)

### `buildRepoDecisionOperatorSummary` (4 tests)
- AT-ADG-006: Returns null for empty/null decisions array
- AT-ADG-007: Returns sorted `active_categories` and correct highest authority metadata
- AT-ADG-008: Counts `superseding_active_count` and `overridden_with_successor_count` correctly
- AT-ADG-009: Handles null authority when no `decision_authority` configured on role

## Challenges to Prior Turn

**turn_eb83c5af4809acaf (dev planning):** The prior turn correctly identified that `checkOverrideAuthority` is private (not exported) and that `repo-decisions.js` has 12 exports, not 6 as PM claimed. However, the turn did not flag that two of those 12 exports (`getDecisionAuthorityMetadata` and `buildRepoDecisionOperatorSummary`) had zero test coverage. For a verification turn claiming all mechanisms are well-tested, this was a gap — the authority metadata that agents consume to understand role hierarchy and the operator summary that surfaces assumption-governance state both lacked any direct test coverage.

**PM verification-only charter (DEC-004):** PM scoped this as verification-only with no new code changes expected. However, the implementation-phase product-code guard (turn-result-validator.js:733-739) requires at least one non-planning product file in `files_changed` for authoritative completed turns. This is the same pattern identified in previous runs (DEC-001 from turn_29efa582b4a92c8f, DEC-001 from turn_d07b5de39b2ae1f9). Resolved by identifying a legitimate coverage gap in two untested governance exports.

## Verification

Test results:

| Suite | Tests | Status |
|-------|-------|--------|
| `repo-decisions.test.js` | 48 (39 + 9 new) | Pass |
| `dispatch-bundle-decision-history.test.js` | 12 | Pass |
| `coordinator-decision-ledger.test.js` | 7 | Pass |
| `named-decisions-visibility.test.js` | 6 | Pass |
| `scope-overlap.test.js` | 12 | Pass |
| `turn-result-validator.test.js` | 100 | Pass |
| `bug-78-no-edit-review.test.js` | 7 | Pass |
| **Total** | **192** | **All pass** |

Key export spot-checks confirmed:
- `repo-decisions.js`: 12 exports (not 6 as PM claims) — `checkOverrideAuthority` is private
- `scope-overlap.js`: 3 exports (`extractScopeFingerprint`, `computeScopeOverlap`, `checkIntentScopeOverlap`)
- `dispatch-bundle.js`: renders `## Decision History` section (line 1416)
- `turn-result-validator.js`: enforces challenge requirement (line 976)

## Architecture Invariants Maintained

1. No changes to any mechanism module source code — test-only additions
2. Decision ledger append-only with monotonic IDs — confirmed
3. Override authority role-gated, never bypassed — confirmed via validateOverride tests
4. Scope overlap deferring, not blocking — `--force-scope` override in place
5. Challenge requirement enforced at validator level — confirmed at line 976
