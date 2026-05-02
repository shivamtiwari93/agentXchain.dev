# Acceptance Matrix — agentXchain.dev

**Run:** run_e9d2aeed559c018e
**Turn:** turn_a4bcf14fdfb2cfc7 (QA)
**Scope:** Idle-expansion exhaustion heuristic fix — `detectRoadmapExhaustedVisionOpen()` now skips tracking-annotated unchecked ROADMAP items, consistent with `deriveRoadmapCandidates()`

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| AC-001 | `detectRoadmapExhaustedVisionOpen()` skips tracked items | Unchecked ROADMAP lines with `<!-- tracking: ... -->` are not counted as actionable unchecked work in the exhaustion heuristic | Test "M2 idle expansion: treats tracking-annotated roadmap items as exhausted" passes | 2026-05-01 | PASS |
| AC-002 | Actionable unchecked items still block exhaustion | Non-tracked unchecked ROADMAP items correctly cause `has_unchecked` return | Test "M2 idle expansion: keeps actionable unchecked roadmap items open" passes | 2026-05-01 | PASS |
| AC-003 | Fully mapped vision scope correctly detected | When all milestones are checked and vision sections map to milestone headings, `vision_fully_mapped` is returned | Test "M2 idle expansion: reports vision fully mapped when exhausted roadmap covers all vision sections" passes | 2026-05-01 | PASS |
| AC-004 | Consistency with `deriveRoadmapCandidates()` | Both functions use the same `ROADMAP_TRACKING_ANNOTATION_PATTERN` regex to filter tracked items | Code inspection: both reference the module-level constant at line 18; live scan confirms M1 acceptance item filtered by both | 2026-05-01 | PASS |
| AC-005 | Live workspace scan correct | `deriveRoadmapCandidates(cwd)` returns 33 candidates with 0 from M1 (tracking-filtered); `detectRoadmapExhaustedVisionOpen()` returns `has_unchecked` because M2-M8 have actionable work | Live scan: ok=true, total=33, M1=0, M2=3; exhaustion=has_unchecked | 2026-05-01 | PASS |
| AC-006 | No regressions in pre-existing test suites | All tests pass across all test files | 270 tests pass (34 vision-reader + 100 validator + 17 staged-result + 42 adapter + 77 schema/timeout/run-loop), 0 failures | 2026-05-01 | PASS |
| AC-007 | No reserved path modifications by dev | Dev changes do not manually edit .agentxchain/state.json, history.jsonl, decision-ledger.jsonl, or lock.json | git diff HEAD~1 confirms dev changed exactly 4 declared files: vision-reader.js, vision-reader.test.js, IMPLEMENTATION_NOTES.md, ROADMAP.md | 2026-05-01 | PASS |
| AC-008 | ROADMAP.md correctly updated | M2 first item "Fix idle-expansion heuristic" marked as checked | Verified in ROADMAP.md line 32: `- [x] Fix idle-expansion heuristic` | 2026-05-01 | PASS |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure and handoff format from prior runs; predates this run entirely | Not a regression — pre-existing state issue; confirmed across 6 consecutive QA runs |

## Challenge Notes

The dev's implementation is a single-line guard clause addition (`vision-reader.js:490`) that mirrors the identical guard already present in `deriveRoadmapCandidates()` at line 264. Both now use the same `ROADMAP_TRACKING_ANNOTATION_PATTERN` module-level constant. The dev correctly challenged the PM scope by adding direct three-state regression tests on `detectRoadmapExhaustedVisionOpen()` rather than relying on indirect coverage from the candidate derivation tests — this is the right approach since the exhaustion detector has its own independent roadmap scan.
