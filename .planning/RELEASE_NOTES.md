# Release Notes — M12: Quality Drift Prevention (Vision Closure)

**Run:** run_08c9a1482479ae2e
**Turn:** turn_6445d6caf44ad1d8 (QA)
**Date:** 2026-05-04

## Summary

Formal closure of VISION.md:33 "quality drifts". This vision bullet is a cross-cutting concern addressed by 8 delivered mechanisms across milestones MW and M1. This run verified the composition, added 50 new tests covering 12 previously-untested quality-gate exports, and formally closed the vision goal.

## What Changed (This Run)

### New Tests: `cli/test/recovery-report-gate.test.js` (12 tests)

- `evaluateRecoveryReport` (6 tests): null for missing file, pass for all required sections, fail for missing/placeholder sections
- `scaffoldRecoveryReport` (3 tests): creates scaffold with blocked reason, no overwrite, JSON-stringifies non-string reasons
- `getSemanticIdForPath` (3 tests): correct IDs for 6 known paths, null for unknown/recovery paths

### New Tests: `cli/test/gate-evaluator-helpers.test.js` (24 tests)

- `getEffectiveGateArtifacts` (6 tests): merges workflow_kit with requires_files, deduplicates, handles empty/missing
- `hasRoleParticipationInPhase` (4 tests): true/false for role participation, handles null/empty state
- `getNextPhase` (5 tests): correct next phase for each position, null for final/unknown/empty
- `getInvalidPhaseTransitionReason` (4 tests): null for valid transitions, reason for skip-forward/final-phase
- `isFinalPhase` (5 tests): true for last declared phase, false for non-final/unknown/empty, true for single-phase

### New Tests: `cli/test/release-alignment-helpers.test.js` (14 tests)

- `escapeRegExp` (3 tests): escapes special characters, leaves plain strings, safe for RegExp constructor
- `formatCount` (2 tests): locale-appropriate grouping for numbers and zero
- `extractTopReleaseSection` (4 tests): extracts matching version section, null for missing, handles last/single heading
- `extractAggregateEvidenceLine` (5 tests): extracts evidence line, null for no match, picks highest count, handles commas/formatting

### ROADMAP Updates

- Item 146 (M12 acceptance) checked off by QA after independent verification of 247/247 tests
- Phases table updated to reflect all three phases completed

## Cumulative Mechanism Delivery (Verified This Run)

| # | Mechanism | Module | Evidence |
|---|-----------|--------|----------|
| 1 | Turn-result validator (5-stage) | `cli/src/lib/turn-result-validator.js` | 100 tests pass (stages at lines 178/638/671/806/966) |
| 2 | Workflow gate semantics (6 evaluators) | `cli/src/lib/workflow-gate-semantics.js` | 52 gate-evaluator + 12 recovery-report tests pass |
| 3 | Phase gate enforcement | `cli/src/lib/governed-state.js` + `gate-evaluator.js` | 10 implementation-gate + 24 gate-evaluator-helpers tests pass |
| 4 | Challenge requirement | `cli/src/lib/turn-result-validator.js:976` | 7 BUG-78 tests pass (review_only must challenge) |
| 5 | Release alignment (8 dimensions) | `cli/src/lib/release-alignment.js` | 6 + 14 alignment-helpers tests pass |
| 6 | Acceptance matrix enforcement | `cli/src/lib/workflow-gate-semantics.js:117` | 8 placeholder-leak tests pass |
| 7 | Release notes enforcement | `cli/src/lib/workflow-gate-semantics.js:258` | 10 release-notes-gate tests pass |
| 8 | E2E release gate | Full pipeline | 4 e2e tests pass |
| | **Total** | | **247 tests, 0 failures** |

## User Impact

- **Vision goal closure**: "quality drifts" is now formally verified as addressed — operators can reference M12 as the closure point for this bullet
- **Improved test coverage**: 12 previously-untested quality-gate exports now have 50 dedicated tests covering `evaluateRecoveryReport`, `scaffoldRecoveryReport`, `getSemanticIdForPath`, `getEffectiveGateArtifacts`, `hasRoleParticipationInPhase`, `getNextPhase`, `getInvalidPhaseTransitionReason`, `isFinalPhase`, `escapeRegExp`, `formatCount`, `extractTopReleaseSection`, `extractAggregateEvidenceLine`
- **No breaking changes**: No source module changes were made — test-only additions

## Verification Summary

QA independently ran all 11 quality-enforcement test suites in a single vitest invocation:
- **247 tests, 0 failures** (exit code 0)
- All 5 architecture invariants confirmed
- All 8 SYSTEM_SPEC acceptance criteria pass
- VISION.md:33 "quality drifts" closed by 8-mechanism composition
