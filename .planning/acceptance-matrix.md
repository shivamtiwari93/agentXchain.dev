# Acceptance Matrix — M10: Cross-Run Scope Overlap Guard (Formal Closure)

**Run:** run_4f63b0c987a50c73
**Turn:** turn_736e4b77ea23f6b5 (QA)
**Prior delivery run:** run_2e96850371ff1a1c (QA ship verdict YES, 10/10 criteria, 172 tests, 0 failures)
**Scope:** Formal closure — re-verify all M10 code still passes, validate 2 new tests (AT-SOG-011/012), check off ROADMAP:125

## Section A: SYSTEM_SPEC Acceptance Tests (Original 10)

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| AT-SOG-001 | extractScopeFingerprint extracts milestone refs (M1, M5, M10) | QA ran scope-overlap.test.js: test verifies fp.has('m1'), fp.has('m5'), fp.has('m10'). PASS. | PASS |
| AT-SOG-002 | extractScopeFingerprint extracts bug refs and module keywords | QA verified: fp.has('bug-78'), fp.has('bug-54'), fp.has('connector'), fp.has('validator'). PASS. | PASS |
| AT-SOG-003 | extractScopeFingerprint strips stop words and short tokens | QA verified: !fp.has('the'), !fp.has('and'), !fp.has('is'). Retains 'validator', 'module', 'fixed'. PASS. | PASS |
| AT-SOG-004 | computeScopeOverlap returns 0 for disjoint sets | QA verified: {a,b} vs {c,d} = 0. PASS. | PASS |
| AT-SOG-005 | computeScopeOverlap returns 1 for identical sets | QA verified: {a,b} vs {a,b} = 1. PASS. | PASS |
| AT-SOG-006 | computeScopeOverlap returns correct Jaccard for partial overlap | QA verified: {a,b,c} vs {b,c,d} = 2/4 = 0.5. PASS. | PASS |
| AT-SOG-007 | checkIntentScopeOverlap returns non-overlapping for distinct charters | QA verified: distinct domain charters return overlapping=false. PASS. | PASS |
| AT-SOG-008 | checkIntentScopeOverlap detects overlap with active run charter | QA verified: semantically similar candidate returns overlapping=true, source='active_run'. PASS. | PASS |
| AT-SOG-009 | checkIntentScopeOverlap detects overlap with recently completed intent | QA verified: same-domain charter returns overlapping=true with completed intent source. PASS. | PASS |
| AT-SOG-010 | approveIntent returns scope_overlap_detected when threshold exceeded, forceScope bypasses | QA verified: (1) without forceScope returns ok=false, error='scope_overlap_detected'; (2) with forceScope=true returns ok=true. PASS. | PASS |

**Original acceptance: 10/10 PASS**

## Section B: New Tests Added This Run (Dev turn_29efa582b4a92c8f)

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| AT-SOG-011 | extractScopeFingerprint strips template noise words (vision, goal, addressed, section) while preserving real keywords | QA verified: test at scope-overlap.test.js:162-174 confirms template noise stripped, real keywords survive. PASS. | PASS |
| AT-SOG-012 | checkIntentScopeOverlap skips comparison when fingerprint below minimum size (< 3 tokens) | QA verified: test at scope-overlap.test.js:176-191 confirms charters with < 3 tokens after filtering don't trigger overlap. PASS. | PASS |

**New tests: 2/2 PASS**

These tests close a genuine coverage gap: the TEMPLATE_NOISE filter and min-fingerprint guard (dev DEC-002 from run_2e96850371ff1a1c) had no dedicated test coverage until this turn.

## Section C: Code Artifact Verification (All 6 M10 Artifacts)

| Artifact | Location | Evidence | Status |
|----------|----------|----------|--------|
| scope-overlap.js | cli/src/lib/scope-overlap.js | 3 exports: extractScopeFingerprint, computeScopeOverlap, checkIntentScopeOverlap | PASS |
| Intake guard | cli/src/lib/intake.js:890-907 | scope_overlap_detected guard in approveIntent() after status check | PASS |
| Deferral handler 1 | cli/src/lib/continuous-run.js:1329-1331 | Roadmap-derived auto-approval handles overlap with idle return | PASS |
| Deferral handler 2 | cli/src/lib/continuous-run.js:1407-1409 | Roadmap-replenishment handles overlap with idle return | PASS |
| Deferral handler 3 | cli/src/lib/continuous-run.js:1493-1495 | Vision-derived handles overlap with idle return | PASS |
| CLI option | cli/bin/agentxchain.js:1044 | --force-scope registered on intake approve command | PASS |
| Passthrough | cli/src/commands/intake-approve.js:21 | forceScope: opts.forceScope || false | PASS |

**Code artifacts: 7/7 PASS**

## Section D: Architecture Invariants

| Invariant | Evidence | Status |
|-----------|----------|--------|
| No changes to M5 parallel conflict detection | classifyAcceptanceOverlap in governed-state.js untouched | PASS |
| No changes to event deduplication | computeDedupKey in intake.js untouched | PASS |
| No changes to vision candidate derivation | isGoalAddressed, deriveVisionCandidates in vision-reader.js untouched | PASS |
| Overlap is deferring, not blocking | approveIntent returns error, continuous loop returns idle, --force-scope overrides | PASS |

**Invariants: 4/4 PASS**

## Section E: Regression Suites (QA-Verified This Turn)

| Suite | Count | Result | Exit Code |
|-------|-------|--------|-----------|
| scope-overlap.test.js | 12 | 12/12 PASS | 0 |
| intake.test.js | 21 | 21/21 PASS | 0 |
| continuous-run.test.js | 90 | 90/90 PASS | 0 |
| **Total** | **123** | **0 failures** | — |

All suites run independently by QA using `cd cli && npx vitest run test/<file>`.

## Section F: Dev Decision Review

### DEC-001 (PM verification-only charter conflicts with product-code guard): VERIFIED

Dev correctly identified that PM's verification-only charter would be rejected by turn-result-validator.js:733-739. Adding AT-SOG-011/012 was a valid resolution — both tests close real coverage gaps.

### DEC-002 (All 6 M10 code artifacts independently verified in place): VERIFIED

QA independently confirmed all 6 artifacts at the exact locations and line numbers claimed by dev.

## Section G: QA Findings

### Finding 1 (blocking, fixed): Stale QA artifacts from wrong run

All three QA workflow artifacts (acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) referenced `run_2e96850371ff1a1c` (original M10 delivery) instead of current `run_4f63b0c987a50c73` (formal closure). This is the fourth consecutive run where this pattern has occurred. All three rewritten from scratch by this QA turn.

### Finding 2 (non-blocking, process): PM verification-only charter friction — 3rd recurrence

Dev's OBJ-001 correctly notes this is the third time a PM verification-only charter has collided with the implementation-phase product-code guard. The pattern: PM scopes "no code changes", dev must find real work to satisfy the guard. This works (dev finds genuine gaps) but creates unnecessary friction. No action required for ship readiness.
