# Release Notes — M10: Cross-Run Scope Overlap Guard (Formal Closure)

**Run:** run_4f63b0c987a50c73
**Prior delivery run:** run_2e96850371ff1a1c

## Summary

Formal closure of M10: Cross-Run Scope Overlap Guard. All code was delivered in run_2e96850371ff1a1c and QA-verified (10/10 criteria, 172 tests, 0 failures). This run re-verified all deliverables, added 2 new tests covering previously untested TEMPLATE_NOISE filter and min-fingerprint guard, and checked off ROADMAP items 120-125.

## What Changed (This Run)

### New Tests: `cli/test/scope-overlap.test.js`

- **AT-SOG-011**: Verifies `extractScopeFingerprint` strips template noise words (`vision`, `goal`, `addressed`, `section`) while preserving real domain keywords
- **AT-SOG-012**: Verifies `checkIntentScopeOverlap` returns non-overlapping when candidate fingerprint has fewer than 3 tokens after filtering

### ROADMAP Updates

- Items 120-124 checked off by PM (turn_1685f54779c1e368) based on QA-verified evidence from run_2e96850371ff1a1c
- Item 125 (M10 acceptance) checked off by QA this turn after independent re-verification

## Cumulative M10 Delivery (from run_2e96850371ff1a1c)

### Module: `cli/src/lib/scope-overlap.js`

- `extractScopeFingerprint(text)` — Extracts normalized tokens: M-prefixed milestones, BUG-prefixed refs, MW, file paths, significant keywords (>3 chars, stop-word and template-noise filtered)
- `computeScopeOverlap(a, b)` — Jaccard similarity between two fingerprint sets
- `checkIntentScopeOverlap(root, charter, acceptanceContract, options)` — Compares candidate intent against active run and recent completed intents

### Integration Points

- **intake.js:890-907** — Scope overlap guard in `approveIntent()`, returns `scope_overlap_detected` when threshold exceeded
- **continuous-run.js:1329,1407,1493** — Three auto-approval sites handle overlap by returning idle with `deferred_reason: 'scope_overlap'`
- **CLI `intake approve --force-scope`** — Bypasses the scope overlap guard for operator override

## User Impact

- **Continuous loop operators:** Overlapping charters automatically deferred until prior work completes. No configuration required — default threshold 0.4 activates automatically.
- **Manual approval operators:** `agentxchain intake approve --force-scope` bypasses when deliberate overlap is intended.
- **Existing workflows:** No breaking changes. Advisory/deferring only. All existing conflict detection, event deduplication, and vision derivation remain untouched.

## Verification Summary

QA independently re-verified all 12 acceptance tests (10 original + 2 new AT-SOG-011/012) and ran 3 regression suites:

- **scope-overlap.test.js**: 12/12 PASS (exit code 0)
- **intake.test.js**: 21/21 PASS (exit code 0)
- **continuous-run.test.js**: 90/90 PASS (exit code 0)
- **Total**: 123 tests, 0 failures

All 6 M10 code artifacts independently confirmed in place at documented locations. 4 architecture invariants maintained.
