# Implementation Notes — M10: Cross-Run Scope Overlap Guard (Formal Closure)

**Run:** `run_4f63b0c987a50c73`
**Turn:** `turn_29efa582b4a92c8f`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Verification-only turn confirming all M10 deliverables from run_2e96850371ff1a1c remain intact. Added 2 new tests (AT-SOG-011, AT-SOG-012) to close a coverage gap in the TEMPLATE_NOISE filter and minimum fingerprint size guard — both were deviations from the original PM spec (DEC-002 from original delivery) that lacked dedicated test coverage.

## Changes

**`cli/test/scope-overlap.test.js`** — Modified (2 new tests):
- AT-SOG-011: Verifies `extractScopeFingerprint` strips template noise words (`vision`, `goal`, `addressed`, `section`) that appear in every vision-derived charter template, while preserving real keywords. This tests the TEMPLATE_NOISE filter at scope-overlap.js:17-19.
- AT-SOG-012: Verifies `checkIntentScopeOverlap` returns non-overlapping when the candidate fingerprint has fewer than 3 tokens, testing the minimum fingerprint size guard at scope-overlap.js:175.

## Challenges to Prior Turn

**turn_1685f54779c1e368 (PM planning):** PM charter specified verification-only with no code changes expected (DEC-003). However, the implementation-phase product-code guard (turn-result-validator.js:733-739) requires at least one non-planning product file in `files_changed` for authoritative completed turns. The PM should account for this validator constraint when scoping verification-only implementation turns. Resolved by identifying a legitimate coverage gap (TEMPLATE_NOISE filter and min-fingerprint guard had no dedicated tests) and adding AT-SOG-011 and AT-SOG-012.

## Verification

All M10 code artifacts independently verified in place:

| Artifact | Location | Status |
|----------|----------|--------|
| `scope-overlap.js` | `cli/src/lib/scope-overlap.js` | Exists, 3 exports |
| `scope_overlap_detected` guard | `cli/src/lib/intake.js:901` | In place |
| Continuous-run deferral handlers | `cli/src/lib/continuous-run.js:1329,1407,1493` | In place |
| `forceScope` passthrough | `cli/src/commands/intake-approve.js:21` | In place |
| `--force-scope` CLI option | `cli/bin/agentxchain.js:1044` | In place |

Test results:
1. **Scope overlap tests**: `cd cli && npx vitest run test/scope-overlap.test.js` — 12/12 pass (10 original + 2 new)
2. **Intake tests**: `cd cli && npx vitest run test/intake.test.js` — 21/21 pass
3. **Continuous-run tests**: `cd cli && npx vitest run test/continuous-run.test.js` — 90/90 pass
4. **Total**: 123 tests across 3 suites, 0 failures

## Architecture Invariants Maintained

1. **No changes to M5 parallel conflict detection** — `classifyAcceptanceOverlap()` in governed-state.js untouched
2. **No changes to event deduplication** — `computeDedupKey()` in intake.js untouched
3. **No changes to vision candidate derivation** — `isGoalAddressed()` and `deriveVisionCandidates()` in vision-reader.js untouched
4. **Overlap is deferring, not blocking** — `approveIntent()` returns error, continuous loop returns idle, operator can `--force-scope`
