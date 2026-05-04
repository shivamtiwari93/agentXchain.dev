# Acceptance Matrix — M10: Cross-Run Scope Overlap Guard

**Run:** run_2e96850371ff1a1c
**Turn:** turn_e7504051098fe94b (QA)
**Scope:** 1 new module (scope-overlap.js), 3 integration sites (intake.js, continuous-run.js, intake-approve.js), 1 CLI option (agentxchain.js), 1 new test file (10 tests)

## Section A: SYSTEM_SPEC Acceptance Tests

| Req # | Requirement (from SYSTEM_SPEC Acceptance Tests) | Evidence | Status |
|-------|--------------------------------------------------|----------|--------|
| AT-SOG-001 | extractScopeFingerprint extracts milestone refs (M1, M5, M10) | QA ran scope-overlap.test.js independently: test verifies fp.has('m1'), fp.has('m5'), fp.has('m10') from input containing M1, M5, M10. PASS. | PASS |
| AT-SOG-002 | extractScopeFingerprint extracts bug refs and module keywords | QA verified: test checks fp.has('bug-78'), fp.has('bug-54'), fp.has('connector'), fp.has('validator'), fp.has('ghost'), fp.has('detection'). PASS. | PASS |
| AT-SOG-003 | extractScopeFingerprint strips stop words and short tokens | QA verified: test asserts !fp.has('the'), !fp.has('and'), !fp.has('is'), !fp.has('a'), !fp.has('on'), !fp.has('it'). Retains 'validator', 'module', 'fixed'. PASS. | PASS |
| AT-SOG-004 | computeScopeOverlap returns 0 for disjoint sets | QA verified: {a,b} vs {c,d} = 0. PASS. | PASS |
| AT-SOG-005 | computeScopeOverlap returns 1 for identical sets | QA verified: {a,b} vs {a,b} = 1. PASS. | PASS |
| AT-SOG-006 | computeScopeOverlap returns correct Jaccard for partial overlap | QA verified: {a,b,c} vs {b,c,d} = 2/4 = 0.5. PASS. | PASS |
| AT-SOG-007 | checkIntentScopeOverlap returns non-overlapping for distinct charters | QA verified: completed Windsurf connector intent vs unrelated CI pipeline charter returns overlapping=false, max_score < 0.4. PASS. | PASS |
| AT-SOG-008 | checkIntentScopeOverlap detects overlap with active run charter | QA verified: active_run with scope overlap charter vs semantically similar candidate returns overlapping=true, source='active_run', max_score >= 0.4. PASS. | PASS |
| AT-SOG-009 | checkIntentScopeOverlap detects overlap with recently completed intent | QA verified: completed Windsurf connector intent vs same-domain charter returns overlapping=true, source='intent:intent_002_efgh', max_score >= 0.4. PASS. | PASS |
| AT-SOG-010 | approveIntent returns scope_overlap_detected when threshold exceeded, forceScope bypasses | QA verified: (1) approveIntent without forceScope returns ok=false, error='scope_overlap_detected', exitCode=3; intent stays triaged. (2) approveIntent with forceScope=true returns ok=true. PASS. | PASS |

**Summary: 10/10 PASS**

## Section B: Code Correctness Verification

| Check | Detail | Status |
|-------|--------|--------|
| scope-overlap.js exports | 3 named exports: extractScopeFingerprint, computeScopeOverlap, checkIntentScopeOverlap. All signatures match SYSTEM_SPEC. | PASS |
| TEMPLATE_NOISE filter (dev DEC-002) | Set of {'vision','goal','addressed','section'} prevents false overlap from vision-derived charter scaffolding. Not in original spec but a valid improvement. | PASS |
| Min fingerprint guard (dev DEC-002) | candidateFP.size < 3 returns non-overlapping. Spec said size === 0; dev raised to < 3 for better false-positive protection. Reasonable deviation. | PASS |
| intake.js scope guard (line 891) | Guard placed after status check (line 886), before approver assignment (line 909). Uses static import (line 31). Matches spec integration point. | PASS |
| continuous-run.js site 1 (line 1329) | Roadmap-derived: scope_overlap_detected returns idle with deferred_reason. Correct. | PASS |
| continuous-run.js site 2 (line 1407) | Roadmap-replenishment: same idle pattern. Correct. | PASS |
| continuous-run.js site 3 (line 1493) | Vision-derived: same idle pattern. Correct. | PASS |
| CLI --force-scope (agentxchain.js:1044) | Option registered on intake approve command. | PASS |
| intake-approve.js passthrough (line 21) | forceScope: opts.forceScope || false passed to approveIntent. | PASS |
| Jaccard correctness | computeScopeOverlap handles empty sets (returns 0, no division by zero), identical sets (returns 1), partial overlap (correct ratio). | PASS |

## Section C: Architecture Invariants

| Invariant | Evidence | Status |
|-----------|----------|--------|
| No changes to M5 parallel conflict detection | git diff 187f3cb4d HEAD -- cli/src/lib/governed-state.js produces empty output | PASS |
| No changes to event deduplication | grep for computeDedupKey in intake.js confirms untouched; scope guard is separate insertion | PASS |
| No changes to vision candidate derivation | git diff 187f3cb4d HEAD -- cli/src/lib/vision-reader.js produces empty output | PASS |
| Overlap is deferring, not blocking | approveIntent returns error (exitCode 3), continuous loop returns idle, --force-scope bypasses | PASS |
| Synchronous implementation | All functions use readFileSync/existsSync, no async/await in scope-overlap.js | PASS |
| No new dependencies | Only node:fs and node:path imports in scope-overlap.js | PASS |

## Section D: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| scope-overlap.test.js | 10 | 10/10 PASS |
| intake.test.js | 21 | 21/21 PASS |
| continuous-run.test.js | 90 | 90/90 PASS |
| intake-approve-plan.test.js + vision-reader.test.js | 51 | 51/51 PASS |
| **Total** | **172** | **0 failures** |

All test suites run independently by QA using `cd cli && npx vitest run test/<file>`. Exit code 0 for all 4 commands.

## Section E: Dev Decision Review

### DEC-001 (No material deviations from PM spec): VERIFIED

QA independently confirmed: all 3 function signatures match, static import used (correct per spec note), guard placement in approveIntent matches spec, 3 continuous-run.js sites match spec, CLI option and command handler match spec.

### DEC-002 (TEMPLATE_NOISE filter and min fingerprint guard): VERIFIED AND APPROVED

TEMPLATE_NOISE set {'vision','goal','addressed','section'} is a valid false-positive prevention for vision-derived charters. Min fingerprint guard (< 3 tokens vs spec's === 0) is a reasonable strengthening. Both are documented. The 2 mid-implementation test failures (AT-VCONT-001, AT-VCONT-006) were caused by this template noise and fully resolved.

### DEC-003 (All 90 continuous-run tests pass with 0 regressions): VERIFIED

QA ran continuous-run.test.js independently: 90/90 pass, exit code 0.

## Section F: QA Findings

### Finding 1 (blocking, fixed): Stale QA artifacts from wrong run

All three QA workflow artifacts (acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) referenced run_cf572ef2d54d357d (MW: BUG-78 Formal Closure) instead of current run_2e96850371ff1a1c (M10: Cross-Run Scope Overlap Guard). All three rewritten from scratch by this QA turn.

### Finding 2 (info): Spec deviation in min fingerprint size

SYSTEM_SPEC pseudocode (line 84) says `candidateFP.size === 0` returns non-overlapping. Implementation uses `candidateFP.size < 3`. This is a valid improvement per dev DEC-002 but constitutes a minor spec deviation. No action needed — the implementation is more conservative.
