# Acceptance Matrix — agentXchain.dev

**Run:** run_bd3c68e0331fa956
**Turn:** turn_d13b150208855cc1 (QA)
**Scope:** M2 Roadmap Replenishment — defense-in-depth annotation sanitization, mixed-state seedFromVision coverage, M2 acceptance counter 1/5

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| AC-001 | seedFromVision handles vision_fully_mapped as idle terminal | When checked roadmap milestones fully map the vision, seedFromVision returns `{ok:true, idle:true, source:'vision_exhausted', reason:'vision_fully_mapped'}` instead of falling through to generic VISION derivation | Test "M2 three-state: returns idle when checked roadmap milestones fully map the vision" passes | 2026-05-01 | PASS |
| AC-002 | seedFromVision seeds replenishment when roadmap functionally exhausted | When only tracking-annotated unchecked items remain and VISION has unplanned scope, seedFromVision returns `{source:'roadmap_replenishment'}` with a `[roadmap-replenishment]` intent | Test "M2 three-state: seeds roadmap replenishment when roadmap is functionally exhausted but vision remains open" passes | 2026-05-01 | PASS |
| AC-003 | Exact M2 #3 status message | Continuous run logs "Roadmap exhausted, vision still open, deriving next increment" (not the old generic message) | BUG-77 command-chain test assert.match on exact string | 2026-05-01 | PASS |
| AC-004 | BUG-77 command-chain tightened assertion | BUG-77 test now requires the exact status message, not a loose regex | `bug-77-roadmap-exhausted-vision-open.test.js` passes with exact match assertion | 2026-05-01 | PASS |
| AC-005 | ROADMAP M2 items #2-#4 correctly checked off | Items #2 (dispatch PM), #3 (status message), #4 (three-state tests) marked `[x]` | Verified in ROADMAP.md lines 33-35 | 2026-05-01 | PASS |
| AC-006 | ROADMAP M2 item #5 tracking annotation updated to 1/5 | Longitudinal acceptance item has `<!-- tracking: 1/5 consecutive runs as of 2026-05-02 -->` at ROADMAP.md line 36 | Verified via grep | 2026-05-01 | PASS |
| AC-007 | Full continuous-run suite — no regressions | All 87 tests pass (was 86 — 1 new mixed-state integration test) | `node --test cli/test/continuous-run.test.js` — 87 pass, 0 fail | 2026-05-01 | PASS |
| AC-008 | Vision-reader suite — no regressions | All 36 tests pass (was 34 — 2 new annotation sanitizer tests) | `node --test cli/test/vision-reader.test.js` — 36 pass, 0 fail | 2026-05-01 | PASS |
| AC-009 | BUG-77 command-chain end-to-end | Full CLI path dispatches replenishment, completes run | `node --test cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js` — 1 pass, 0 fail | 2026-05-01 | PASS |
| AC-010 | Validator + staged-result + adapter suites — no regressions | All 156 tests pass | `node --test cli/test/turn-result-validator.test.js cli/test/staged-result-proof.test.js cli/test/local-cli-adapter.test.js` — 156 pass, 0 fail | 2026-05-01 | PASS |
| AC-011 | Config + timeout + run-loop suites — no regressions | All 77 tests pass | `node --test cli/test/agentxchain-config-schema.test.js cli/test/timeout-evaluator.test.js cli/test/run-loop.test.js` — 77 pass, 0 fail | 2026-05-01 | PASS |
| AC-012 | No reserved path modifications by dev | Dev changes do not manually edit .agentxchain/state.json, history.jsonl, decision-ledger.jsonl, or lock.json | `git diff 11d682768~1..11d682768 -- .agentxchain/` returns empty | 2026-05-01 | PASS |
| AC-013 | Diff minimality | Dev changed exactly 5 declared files: vision-reader.js (+8 source lines), continuous-run.test.js (+35 test lines), vision-reader.test.js (+15 test lines), ROADMAP.md, IMPLEMENTATION_NOTES.md | `git diff --stat` confirms 80 insertions, 4 deletions across 5 files | 2026-05-01 | PASS |
| AC-014 | stripRoadmapTrackingAnnotations defense-in-depth | Sanitizer strips `<!-- tracking: ... -->` from goal text at extraction time, preserves non-tracking HTML comments | Tests "M2 defense-in-depth: strips tracking annotation text" and "preserves non-tracking roadmap comments" pass | 2026-05-01 | PASS |
| AC-015 | Mixed-state seedFromVision coverage | seedFromVision with tracked M1/M2 + untracked M3 items seeds M3, no tracking metadata leaks into intent | Test "M2 acceptance tracking: skips tracked M1/M2 items and seeds the next untracked roadmap milestone" passes | 2026-05-01 | PASS |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure, decision references, and handoff format from prior runs; predates this run entirely | Not a regression — pre-existing state issue; confirmed across 8 consecutive QA runs |

## Challenge Notes

The dev's implementation addresses the PM's timing-anomaly diagnosis with two layered defenses: (1) `stripRoadmapTrackingAnnotations()` at goal extraction in `deriveRoadmapCandidates()` ensures that even if the tracking annotation skip on line 269 were somehow bypassed (e.g., the timing anomaly where a checkpoint writes after the vision scan reads), the annotation metadata would not leak into seeded candidate text; (2) the mixed-state integration test at `seedFromVision()` validates the end-to-end path with tracked M1/M2 items plus untracked M3, confirming both that tracked items are skipped and that no `tracking:` metadata appears in the generated intent charter or acceptance contract. These are defense-in-depth additions — the primary tracking-annotation skip was already working. The M2 longitudinal counter advancement (0/5→1/5) is correctly scoped: the system found work (M3-M8 derivable from VISION.md) and did not idle-stop, which counts as a qualifying run.
