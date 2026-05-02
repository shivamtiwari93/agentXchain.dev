# Release Notes

## User Impact

Defense-in-depth hardening for the M2 roadmap replenishment pipeline:

1. **Annotation sanitizer** — `stripRoadmapTrackingAnnotations()` now strips `<!-- tracking: ... -->` metadata from roadmap goal text at extraction time in `deriveRoadmapCandidates()`. This prevents tracking metadata from leaking into seeded intent charters or acceptance contracts, even under the timing anomaly where a vision scan reads ROADMAP.md before a prior run's checkpoint persists.

2. **Mixed-state integration coverage** — New `seedFromVision()` test validates the combined scenario of tracked M1/M2 acceptance items plus untracked M3 work, confirming that tracked items are skipped and M3 is correctly seeded with no metadata leakage.

3. **M2 acceptance counter** — Longitudinal item #5 advanced from 0/5 to 1/5 consecutive runs. This run found derivable VISION scope (M3-M8) and did not idle-stop, qualifying as a successful run toward the 5-run acceptance threshold.

## Verification Summary

- 458 tests pass across 10 test suites independently verified, 0 failures:
  - continuous-run.test.js: 87 pass (1 new mixed-state integration test)
  - vision-reader.test.js: 36 pass (2 new annotation sanitizer tests)
  - bug-77-roadmap-exhausted-vision-open.test.js: 1 pass
  - turn-result-validator + staged-result-proof + local-cli-adapter: 156 pass
  - agentxchain-config-schema + timeout-evaluator + run-loop: 77 pass
  - coordinator-state + gates + schema + decision-ledger + run-completion: 79 pass
  - timeout-governed-state + report suites: 12 pass
  - release-notes-gate: 10 pass
- All 15 acceptance criteria verified (see acceptance-matrix.md)
- No reserved `.agentxchain/` file modifications by dev

## Upgrade Notes

No breaking changes. The `stripRoadmapTrackingAnnotations()` function is a new named export from `vision-reader.js`. Callers that import specific functions are unaffected; callers using wildcard imports will see the new export.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs. Confirmed across 8 consecutive QA runs.
- M2 item #5 (5+ consecutive runs without idle-stopping) is longitudinal and tracked at 1/5 runs.
