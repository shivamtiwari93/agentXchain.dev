# Acceptance Matrix — agentXchain.dev

**Run:** run_b51cc53d95925d53
**Turn:** turn_c0bfb7b868f43a02 (QA)
**Scope:** M2 Roadmap Replenishment — seedFromVision three-state integration, exact status messaging, and ROADMAP tracking updates

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| AC-001 | seedFromVision handles vision_fully_mapped as idle terminal | When checked roadmap milestones fully map the vision, seedFromVision returns `{ok:true, idle:true, source:'vision_exhausted', reason:'vision_fully_mapped'}` instead of falling through to generic VISION derivation | Test "M2 three-state: returns idle when checked roadmap milestones fully map the vision" passes | 2026-05-02 | PASS |
| AC-002 | seedFromVision seeds replenishment when roadmap functionally exhausted | When only tracking-annotated unchecked items remain and VISION has unplanned scope, seedFromVision returns `{source:'roadmap_replenishment'}` with a `[roadmap-replenishment]` intent | Test "M2 three-state: seeds roadmap replenishment when roadmap is functionally exhausted but vision remains open" passes | 2026-05-02 | PASS |
| AC-003 | Exact M2 #3 status message | Continuous run logs "Roadmap exhausted, vision still open, deriving next increment" (not the old generic message) | Test assertion in continuous-run.test.js + BUG-77 command-chain test assert.match on exact string | 2026-05-02 | PASS |
| AC-004 | BUG-77 command-chain tightened assertion | BUG-77 test now requires the exact status message, not a loose regex | `bug-77-roadmap-exhausted-vision-open.test.js` passes with exact match assertion | 2026-05-02 | PASS |
| AC-005 | ROADMAP M2 items #2-#4 correctly checked off | Items #2 (dispatch PM), #3 (status message), #4 (three-state tests) marked `[x]` | Verified in ROADMAP.md lines 33-35 via git diff | 2026-05-02 | PASS |
| AC-006 | ROADMAP M2 item #5 has tracking annotation | Longitudinal acceptance item has `<!-- tracking: 0/5 consecutive runs as of 2026-05-02 -->` | Verified in ROADMAP.md line 36 via git diff | 2026-05-02 | PASS |
| AC-007 | Full continuous-run suite — no regressions | All 86 tests pass | `node --test cli/test/continuous-run.test.js` — 86 pass, 0 fail | 2026-05-02 | PASS |
| AC-008 | Vision-reader suite — no regressions | All 34 tests pass | `node --test cli/test/vision-reader.test.js` — 34 pass, 0 fail | 2026-05-02 | PASS |
| AC-009 | BUG-77 command-chain end-to-end | Full CLI path dispatches replenishment, completes run | `node --test cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js` — 1 pass, 0 fail | 2026-05-02 | PASS |
| AC-010 | Validator + staged-result + adapter suites — no regressions | All 156 tests pass | `node --test cli/test/turn-result-validator.test.js cli/test/staged-result-proof.test.js cli/test/local-cli-adapter.test.js` — 156 pass, 0 fail | 2026-05-02 | PASS |
| AC-011 | Config + timeout + run-loop suites — no regressions | All 77 tests pass | `node --test cli/test/agentxchain-config-schema.test.js cli/test/timeout-evaluator.test.js cli/test/run-loop.test.js` — 77 pass, 0 fail | 2026-05-02 | PASS |
| AC-012 | No reserved path modifications by dev | Dev changes do not manually edit .agentxchain/state.json, history.jsonl, decision-ledger.jsonl, or lock.json | `git diff eeb0be46d~1..eeb0be46d -- .agentxchain/` returns empty | 2026-05-02 | PASS |
| AC-013 | Diff minimality | Dev changed exactly 5 declared files: continuous-run.js (+13 source lines), continuous-run.test.js (+52 test lines), bug-77 test (+4/-4), ROADMAP.md, IMPLEMENTATION_NOTES.md | `git diff --stat` confirms 93 insertions, 10 deletions across 5 files | 2026-05-02 | PASS |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure, decision references, and handoff format from prior runs; predates this run entirely | Not a regression — pre-existing state issue; confirmed across 7 consecutive QA runs |

## Challenge Notes

The dev correctly challenged the prior PM scope by identifying that `seedFromVision()` had a fallthrough gap: when `detectRoadmapExhaustedVisionOpen()` returned `vision_fully_mapped` or `vision_no_actionable_scope` (non-open terminal results), the function fell through to `deriveVisionCandidates()` instead of returning an idle terminal state. This could seed new work from already-mapped vision goals. The dev's 9-line guard clause at line 1405-1412 is correctly positioned between the exhaustion-open handler and the generic vision derivation fallback, and the integration tests validate all three states at the `seedFromVision()` boundary, not just the detector.
