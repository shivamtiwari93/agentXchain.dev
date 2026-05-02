# Release Notes

## User Impact

The idle-expansion exhaustion heuristic in `detectRoadmapExhaustedVisionOpen()` now correctly skips tracking-annotated unchecked ROADMAP items when deciding whether actionable unchecked work remains. Previously, this function counted `<!-- tracking: ... -->` annotated items as unchecked work, while `deriveRoadmapCandidates()` already skipped them — causing an inconsistency where the exhaustion detector would report `has_unchecked` even though the candidate derivation function found no actionable items.

This fix ensures both functions agree: when a ROADMAP milestone has only tracking-annotated unchecked items (e.g., longitudinal acceptance criteria like "zero ghost turns across 10 consecutive runs"), the milestone is treated as exhausted by both the candidate derivation and the exhaustion heuristic. If VISION.md has unplanned scope beyond those milestones, the system can now correctly trigger PM to derive the next roadmap increment.

## Verification Summary

- 270 tests pass across 5 test suites (34 vision-reader + 100 validator + 17 staged-result + 42 adapter + 77 schema/timeout/run-loop), 0 failures
- 3 new regression tests added: tracked-only roadmap exhaustion, actionable unchecked items, fully mapped vision scope
- Live workspace scan: 33 candidates with 0 from M1 (tracking-filtered); exhaustion detector returns `has_unchecked` because M2-M8 have actionable work
- All 8 acceptance criteria verified (see acceptance-matrix.md)

## Upgrade Notes

No breaking changes. This is a bug fix that corrects an internal inconsistency. No user-facing API or configuration changes.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs.
