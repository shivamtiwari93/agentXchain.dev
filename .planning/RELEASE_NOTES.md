# Release Notes

## User Impact

Runtime identity is now preserved and rendered in governed handoff context:

1. **Decision ledger runtime_id** — `acceptGovernedTurn()` now persists the `runtime_id` from turn results into each decision ledger entry. This enables downstream agents and operators to see which runtime produced each decision in the governance audit trail.

2. **CONTEXT.md Last Accepted Turn** — The generated CONTEXT.md now includes a `- **Runtime:** <runtime_id>` line in the Last Accepted Turn section when runtime identity is available. This gives the next dispatched agent visibility into which runtime completed the prior turn, improving cross-model handoff awareness.

3. **Decision History Runtime column** — The CONTEXT.md decision history table now includes a Runtime column. Pre-M3 ledger entries render an empty cell; new entries show the runtime identity. This provides a complete audit view of which runtime contributed each decision across the run's lifecycle.

## Verification Summary

- 545 tests pass across 9 test suites independently verified, 0 new failures
  - governed-state.test.js: 99 pass (runtime_id ledger persistence assertion added)
  - dispatch-bundle.test.js: 74 pass (Last Accepted Turn runtime rendering + Decision History Runtime column tests added)
  - continuous-run.test.js: 87 pass
  - vision-reader.test.js: 36 pass
  - turn-result-validator + staged-result-proof + local-cli-adapter: 156 pass
  - agentxchain-config-schema + timeout-evaluator + run-loop: 77 pass
  - release-notes-gate: 10 pass
  - bug-77 end-to-end: 1 pass
  - agent-talk-word-cap: 5 pass (3 pre-existing failures, not regression)
- All 17 acceptance criteria verified (see acceptance-matrix.md)
- No reserved `.agentxchain/` file modifications by dev
- Backward compatibility verified: pre-M3 ledger entries render cleanly with empty Runtime cells

## Upgrade Notes

No breaking changes. Decision ledger entries gain an optional `runtime_id` field. CONTEXT.md decision history table grows from 4 to 5 columns. Both changes are backward-compatible with existing ledger data.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs. Confirmed across 9 consecutive QA runs.
- M1 item #5 (10 consecutive zero-ghost runs) is longitudinal, tracked at 3/10.
- M2 item #5 (5+ consecutive runs without idle-stopping) is longitudinal, tracked at 1/5.
