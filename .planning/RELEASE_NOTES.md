# Release Notes

## User Impact

The vision scanner's `deriveRoadmapCandidates()` function now recognizes `<!-- tracking: ... -->` inline annotations on unchecked ROADMAP.md items. Annotated items are skipped during candidate derivation, preventing the continuous loop from re-triggering work on longitudinal acceptance criteria that cannot be completed in a single governed cycle (e.g., "zero ghost turns across 10 consecutive runs").

This eliminates the re-trigger loop where the vision scanner repeatedly queued already-in-progress longitudinal work, causing wasted PM/Dev/QA cycles on items that require multi-run observation.

Non-annotated unchecked items — including items with other HTML comments like `<!-- owner: dev -->` — remain fully actionable. The annotation is case-insensitive and requires a complete `<!-- tracking: ... -->` form (colon required, closing `-->` required).

## Verification Summary

- 267 tests pass across 5 test suites (31 vision-reader + 100 validator + 17 staged-result + 42 adapter + 77 schema/timeout/run-loop), 0 failures
- 2 new regression tests added: tracking annotation skip + normal HTML comment preservation
- 8 regex edge cases independently verified (valid annotations, empty annotations, case-insensitive, no-space, missing colon, different annotation type, bare word, unclosed annotation)
- Live workspace scan: 35 candidates emitted, M1 acceptance item correctly filtered, M2+ items correctly emitted
- All 8 acceptance criteria verified (see acceptance-matrix.md)

## Upgrade Notes

No breaking changes. Existing ROADMAP.md files without `<!-- tracking: ... -->` annotations behave identically to before. To use the new feature, add an inline `<!-- tracking: description -->` annotation to any unchecked roadmap item that should be excluded from vision scanner candidate derivation.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs.
