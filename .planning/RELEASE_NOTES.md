# Release Notes

## User Impact

The `seedFromVision()` continuous-mode entry point now correctly handles all three terminal states from the roadmap exhaustion detector:

1. **Roadmap has open work** — seeds an intent from the next unchecked roadmap item (existing behavior, unchanged).
2. **Roadmap functionally exhausted, vision still open** — dispatches PM for roadmap replenishment with the exact status message "Roadmap exhausted, vision still open, deriving next increment" (BUG-77 path, now with correct log message per M2 #3 spec).
3. **Vision fully mapped / no actionable scope** — returns idle instead of falling through to generic VISION derivation (new guard). Previously, `vision_fully_mapped` and `vision_no_actionable_scope` results from the exhaustion detector were ignored, causing `seedFromVision()` to attempt broad per-goal vision candidate derivation against already-mapped goals.

M2 ROADMAP items #2 (PM dispatch), #3 (status message), and #4 (three-state tests) are now complete. Item #5 (longitudinal 5-run acceptance) has a tracking annotation and will be completed across future runs.

## Verification Summary

- 354 tests pass across 7 test suites, 0 failures:
  - continuous-run.test.js: 86 pass (includes 2 new seedFromVision three-state tests)
  - vision-reader.test.js: 34 pass
  - bug-77-roadmap-exhausted-vision-open.test.js: 1 pass (tightened to exact status message assertion)
  - turn-result-validator.test.js: 100 pass
  - staged-result-proof.test.js + local-cli-adapter.test.js: 56 pass
  - agentxchain-config-schema.test.js + timeout-evaluator.test.js + run-loop.test.js: 77 pass
- All 13 acceptance criteria verified (see acceptance-matrix.md)
- BUG-77 command-chain end-to-end test passes with exact status message validation
- No reserved `.agentxchain/` file modifications by dev

## Upgrade Notes

No breaking changes. The new `vision_exhausted` idle return from `seedFromVision()` includes `source` and `reason` fields not present in the previous idle returns. Callers that check `seeded.idle === true` are unaffected; callers that inspect `seeded.source` will now see `'vision_exhausted'` with `reason: 'vision_fully_mapped'` or `reason: 'vision_no_actionable_scope'`.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs. Confirmed across 7 consecutive QA runs.
- M2 item #5 (5+ consecutive runs without idle-stopping) is longitudinal and tracked at 0/5 runs.
