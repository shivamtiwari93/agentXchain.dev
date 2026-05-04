# System Spec — M10: Cross-Run Scope Overlap Guard (Formal Closure)

**Run:** `run_4f63b0c987a50c73`
**Baseline:** git:99c639d56 (latest checkpoint)
**Prior delivery run:** `run_2e96850371ff1a1c` (QA ship verdict YES, 10/10 criteria, 172 tests, 0 failures)

## Purpose

This run formally closes M10 by checking off ROADMAP.md items and re-verifying that all delivered code still passes. No new code changes are expected.

M10 was fully delivered in run_2e96850371ff1a1c: `scope-overlap.js` module with `extractScopeFingerprint()`, `computeScopeOverlap()`, `checkIntentScopeOverlap()`, integrated into `approveIntent()` (intake.js:901) and `seedFromVision()` (continuous-run.js lines 1329, 1407, 1493), with `--force-scope` CLI flag (agentxchain.js:1044, intake-approve.js:21) and 10 acceptance tests (scope-overlap.test.js).

The ROADMAP items (lines 120-124) were not checked off after QA, causing the vision scanner to re-trigger this work. PM has now checked them off based on verified evidence.

## Interface

### Existing Module: `cli/src/lib/scope-overlap.js` (delivered run_2e96850371ff1a1c)

```javascript
export function extractScopeFingerprint(text)  // → Set<string>
export function computeScopeOverlap(a, b)       // → number (0.0–1.0 Jaccard)
export function checkIntentScopeOverlap(root, charter, acceptanceContract, options = {})
  // → { overlapping: boolean, matches: Array<{source, charter, score}>, max_score: number }
```

### Integration Points (all in place)

| Location | Change | Evidence |
|----------|--------|----------|
| `cli/src/lib/intake.js:901` | `scope_overlap_detected` guard in `approveIntent()` | `grep scope_overlap_detected intake.js` |
| `cli/src/lib/continuous-run.js:1329,1407,1493` | Handle overlap deferral at 3 auto-approval sites | `grep scope_overlap_detected continuous-run.js` |
| `cli/src/commands/intake-approve.js:21` | `forceScope` passthrough | `grep forceScope intake-approve.js` |
| `cli/bin/agentxchain.js:1044` | `--force-scope` CLI option | `grep force-scope agentxchain.js` |

### Dev Charter

**Verification-only.** Re-run test suites to confirm M10 delivery still holds on the current codebase:

```bash
cd cli && npx vitest run test/scope-overlap.test.js
cd cli && npx vitest run test/intake.test.js
cd cli && npx vitest run test/continuous-run.test.js
```

No new code changes expected. If any test fails, investigate and fix as a regression (not new M10 work).

### Architecture Invariants (unchanged from prior delivery)

1. No changes to M5 parallel conflict detection (`classifyAcceptanceOverlap()`)
2. No changes to event deduplication (`computeDedupKey()`)
3. No changes to vision candidate derivation (`isGoalAddressed()`, `deriveVisionCandidates()`)
4. Overlap is deferring, not blocking — `approveIntent()` returns error, continuous loop returns idle, `--force-scope` overrides

## Acceptance Tests

All 10 tests in `cli/test/scope-overlap.test.js` (AT-SOG-001 through AT-SOG-010) must pass:

| # | Test ID | Description | Status |
|---|---------|-------------|--------|
| 1 | AT-SOG-001 | `extractScopeFingerprint` extracts milestone refs | Passing (verified this turn) |
| 2 | AT-SOG-002 | `extractScopeFingerprint` extracts bug refs and module keywords | Passing |
| 3 | AT-SOG-003 | `extractScopeFingerprint` strips stop words and short tokens | Passing |
| 4 | AT-SOG-004 | `computeScopeOverlap` returns 0 for disjoint sets | Passing |
| 5 | AT-SOG-005 | `computeScopeOverlap` returns 1 for identical sets | Passing |
| 6 | AT-SOG-006 | `computeScopeOverlap` returns correct Jaccard for partial overlap | Passing |
| 7 | AT-SOG-007 | `checkIntentScopeOverlap` returns non-overlapping for distinct charters | Passing |
| 8 | AT-SOG-008 | `checkIntentScopeOverlap` detects overlap with active run charter | Passing |
| 9 | AT-SOG-009 | `checkIntentScopeOverlap` detects overlap with recently completed intent | Passing |
| 10 | AT-SOG-010 | `approveIntent` returns `scope_overlap_detected` when threshold exceeded, `forceScope` bypasses | Passing |

No regressions in `intake.test.js` or `continuous-run.test.js`.
