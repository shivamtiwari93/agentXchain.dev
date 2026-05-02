# Release Notes

## User Impact

### Cross-Model Challenge Quality Regression Coverage (M3 #4)

The governance machinery now has executable integration test coverage proving that cross-model challenge quality is preserved through the accepted-turn pipeline. Operators can trust that:

1. **Decision ledger runtime attribution** — When QA (Opus 4.6) challenges Dev (GPT 5.5), the decision ledger preserves the `runtime_id` of each model. This enables post-run auditing of which model produced which decisions.

2. **Objection preservation** — QA objections raised against a dev turn are preserved verbatim in the accepted history entry, including severity, statement, and status. This ensures cross-model challenge findings survive the acceptance pipeline.

3. **CONTEXT.md handoff rendering** — The next dispatched turn's CONTEXT.md correctly renders runtime identity in both the Last Accepted Turn section and the Decision History table, enabling the receiving model to see who produced the prior work.

### M3 Milestone Progress

- M3 item #4 (cross-model challenge quality) is now complete. The PM audit across 10 completed governed cycles found 7 substantive QA→Dev objections, 7 substantive Dev→PM objections (4 medium-severity overrides validated by QA), and zero post-ship regressions.
- M3 item #5 (3 consecutive cycles with all 4 roles) is tracked at 3/4 roles validated. `eng_director` has not been dispatched in a normal governed cycle.

## Verification Summary

- 574 tests pass across 11 independently verified test suites, 0 failures
  - dispatch-bundle-decision-history.test.js: 11 pass (1 new: cross-model challenge attribution persistence)
  - checkpoint-turn.test.js: 12 pass
  - governed-state.test.js: 99 pass
  - dispatch-bundle.test.js: 74 pass
  - turn-result-validator.test.js: 100 pass
  - staged-result-proof.test.js: 14 pass
  - continuous-run.test.js: 87 pass
  - local-cli-adapter.test.js: 46 pass
  - vision-reader.test.js: 36 pass
  - claude-local-auth-smoke-probe.test.js: 8 pass
  - config-schema + timeout-evaluator + run-loop + release-notes-gate: 87 pass
- Cross-model challenge quality acceptance contract: all 10 criteria verified (see acceptance-matrix.md)
- `agentxchain.json` confirmed unmodified via git diff
- No reserved `.agentxchain/` file modifications by dev

## Upgrade Notes

No breaking changes. The new test file is additive — no product code was modified in this run. The test validates existing governance machinery behavior.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs. Confirmed across 13 consecutive QA runs.
- M1 item #5 (10 consecutive zero-ghost runs) is longitudinal, tracked at 3/10.
- M2 item #5 (5+ consecutive runs without idle-stopping) is longitudinal, tracked at 1/5.
- M3 item #5 (3 consecutive full cycles with all 4 roles) tracked at 3/4 roles; eng_director pending.
