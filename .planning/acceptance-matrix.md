# Acceptance Matrix — agentXchain.dev

**Run:** run_cc4217fafd6611bc
**Turn:** turn_aa17ddc773fe0fa4 (QA)
**Scope:** ROADMAP tracking annotation support — prevent vision scanner from re-triggering longitudinal unchecked items

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| AC-001 | Tracking annotation skips unchecked ROADMAP items | `deriveRoadmapCandidates()` does not emit candidates for unchecked lines containing a complete `<!-- tracking: ... -->` annotation | Test "M1 tracking: skips unchecked roadmap items with tracking annotations" passes | 2026-05-01 | PASS |
| AC-002 | Normal HTML comments remain actionable | Unchecked ROADMAP items with non-tracking HTML comments (e.g. `<!-- owner: dev -->`) are still emitted as candidates | Test "M1 tracking: keeps normal HTML comments actionable" passes | 2026-05-01 | PASS |
| AC-003 | Bare word "tracking" without annotation is not filtered | An unchecked line containing the word "tracking" without the `<!-- tracking: ... -->` annotation is still emitted | Covered by test "M1 tracking: keeps normal HTML comments actionable" + manual regex edge case verification (8/8 cases pass) | 2026-05-01 | PASS |
| AC-004 | Regex requires complete annotation (colon + closing tag) | `<!-- tracking -->` (no colon) and `<!-- tracking: open` (no `-->`) do NOT match the filter | Manual regex edge case verification: both cases correctly return false | 2026-05-01 | PASS |
| AC-005 | Case-insensitive matching | `<!-- TRACKING: ... -->` and `<!--tracking:...-->` both match | Manual regex edge case verification: both variants correctly match | 2026-05-01 | PASS |
| AC-006 | Live workspace scan correct | `deriveRoadmapCandidates(cwd)` returns 35 candidates, does NOT emit the M1 acceptance item (which has tracking annotation), and correctly emits M2+ items | Live scan: ok=true, total=35, M1 filtered, M2 count=5 | 2026-05-01 | PASS |
| AC-007 | No regressions in pre-existing test suites | All pre-existing tests continue to pass across all test files | 267 tests pass (31 vision-reader + 100 validator + 17 staged-result + 42 adapter + 77 schema/timeout/run-loop) | 2026-05-01 | PASS |
| AC-008 | No reserved path modifications by dev | Dev changes do not manually edit .agentxchain/state.json, history.jsonl, decision-ledger.jsonl, or lock.json | git diff confirms reserved file changes are orchestrator checkpointing only; dev declared only 3 product files | 2026-05-01 | PASS |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure and handoff format from prior runs; predates this run entirely | Not a regression — pre-existing state issue; confirmed in 4+ consecutive QA runs |

## Challenge Notes

The dev correctly tightened the PM's implementation spec: PM stated a `<!-- tracking:` substring check, but dev implemented a complete annotation pattern requiring both the colon separator and closing `-->` tag. This is the right call — it prevents false positives on partial or malformed annotations.
