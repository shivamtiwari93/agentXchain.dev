# Release Notes — M11: Assumption Divergence Governance (Vision Closure)

**Run:** run_a413eee8dd1891c7
**Date:** 2026-05-04

## Summary

Formal closure of VISION.md:32 "assumptions diverge". This vision bullet is a cross-cutting concern addressed by 7 delivered mechanisms across milestones M1, M3, M10, and MW. This run verified the composition, added 9 new tests covering previously-untested governance exports, and formally closed the vision goal.

## What Changed (This Run)

### New Tests: `cli/test/repo-decisions.test.js` (9 tests)

**`getDecisionAuthorityMetadata` (5 tests):**
- AT-ADG-001: Returns null for config without roles property
- AT-ADG-002: Returns `configured` source for role with explicit authority
- AT-ADG-003: Returns `human_default` source for human role without explicit authority
- AT-ADG-004: Returns `configured` source for human role with explicit authority
- AT-ADG-005: Returns `unknown_role` source for unconfigured role

**`buildRepoDecisionOperatorSummary` (4 tests):**
- AT-ADG-006: Returns null for empty/null decisions
- AT-ADG-007: Returns sorted active categories and highest authority metadata
- AT-ADG-008: Counts superseding and overridden decisions correctly
- AT-ADG-009: Handles null authority gracefully

### ROADMAP Updates

- Item 135 (M11 acceptance) checked off by QA after independent verification
- Phases table updated to reflect completed state

## Cumulative Mechanism Delivery (Verified This Run)

| # | Mechanism | Module | Evidence |
|---|-----------|--------|----------|
| 1 | Decision ledger + override authority | `cli/src/lib/repo-decisions.js` | 48 tests pass (12 exports, role-gated overrides) |
| 2 | Decision history in dispatch bundles | `cli/src/lib/dispatch-bundle.js` | 12 tests pass (line 1416 renders history) |
| 3 | Coordinator decision ledger | `cli/src/lib/governed-state.js` | 7 tests pass (5 coordination events) |
| 4 | Named decisions visibility | `cli/src/lib/repo-decisions.js` | 6 tests pass (per-repo breakdowns) |
| 5 | Turn-result validator + challenge | `cli/src/lib/turn-result-validator.js` | 100 tests pass (line 976 challenge req) |
| 6 | Scope overlap guard | `cli/src/lib/scope-overlap.js` | 12 tests pass (Jaccard + intake guard) |
| 7 | No-edit review normalization | `cli/src/lib/turn-result-validator.js` | 7 tests pass (BUG-78 Rule 0a) |
| | **Total** | | **192 tests, 0 failures** |

## User Impact

- **Vision goal closure**: "assumptions diverge" is now formally verified as addressed — operators can reference M11 as the closure point for this bullet
- **Improved test coverage**: Two previously-untested governance exports (`getDecisionAuthorityMetadata`, `buildRepoDecisionOperatorSummary`) now have dedicated test suites
- **No breaking changes**: This was a verification-only run. No source module changes were made.

## Verification Summary

QA independently ran all 7 mechanism test suites in a single vitest invocation:
- **192 tests, 0 failures** (exit code 0)
- All 5 architecture invariants confirmed
- All 7 SYSTEM_SPEC acceptance criteria pass
- VISION.md:32 "assumptions diverge" closed by 7-mechanism composition
