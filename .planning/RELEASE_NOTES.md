# Release Notes

## User Impact

### M3 Milestone Complete: Multi-Model Turn Handoff Quality

All five M3 acceptance items are now checked off. The governed pipeline has been validated for all four roles (PM, Dev, QA, eng_director) across both Claude and GPT runtimes.

### eng_director Acceptance Pipeline Regression (M3 #5)

The governance machinery now has executable integration test coverage proving that eng_director escalation turns are accepted identically to PM, Dev, and QA turns through the full governed persistence pipeline. Operators can trust that:

1. **Director history persistence** — eng_director turns persist to `history.jsonl` with role, `runtime_id`, and objections intact.

2. **Decision ledger runtime attribution** — Director decisions appear in `decision-ledger.jsonl` with correct `runtime_id` and `role` fields, enabling post-run auditing of escalation decision provenance.

3. **CONTEXT.md handoff rendering** — The follow-up turn's CONTEXT.md correctly renders the director's role, runtime identity, and objections in both Last Accepted Turn and Decision History sections.

4. **Escalation routing** — Dev turns can propose `eng_director` as next role, the director turn is assigned and accepted, and the pipeline routes correctly to the next phase role.

### M3 Milestone Summary

| Item | Description | Evidence |
|------|-------------|----------|
| #1 | Claude-to-GPT and GPT-to-Claude handoffs preserve full context | 13+ production governed cycles |
| #2 | stream-json and --json output formats correctly parsed | Codex output format validation tests |
| #3 | Model identity metadata in turn checkpoints | Checkpoint runtime identity tests |
| #4 | Cross-model challenge quality (QA Opus 4.6 vs Dev GPT 5.5) | Integration test + 10-cycle PM audit |
| #5 | All 4 roles produce valid turn results | PM/Dev/QA: 13+ production cycles; eng_director: governed-pipeline integration test |

## Verification Summary

- 596 core governance tests pass across 12 independently verified test suites, 0 failures
  - dispatch-bundle-decision-history.test.js: 12 pass (1 new: eng_director escalation pipeline)
  - checkpoint-turn.test.js: 12 pass
  - governed-state.test.js: 99 pass
  - dispatch-bundle.test.js: 74 pass
  - turn-result-validator.test.js: 100 pass
  - staged-result-proof.test.js: 14 pass
  - continuous-run.test.js: 87 pass
  - local-cli-adapter.test.js: 46 pass
  - vision-reader.test.js: 36 pass
  - claude-local-auth-smoke-probe.test.js: 8 pass
  - timeout-evaluator + run-loop + release-notes-gate: 80 pass
  - config-governed.test.js: 28 pass
- Full suite: 6993 pass / 30 fail (all in infrastructure-dependent E2E suites, not related to this change)
- eng_director acceptance contract: all 10 criteria verified (see acceptance-matrix.md)
- `agentxchain.json` confirmed unmodified
- No reserved `.agentxchain/` file modifications by dev

## Upgrade Notes

No breaking changes. The new test is additive — no product code was modified in this run. The test validates existing governance machinery behavior with the eng_director role.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs. Confirmed across 14 consecutive QA runs.
- M1 item #5 (10 consecutive zero-ghost runs) is longitudinal, tracked at 3/10.
- M2 item #5 (5+ consecutive runs without idle-stopping) is longitudinal, tracked at 1/5.
