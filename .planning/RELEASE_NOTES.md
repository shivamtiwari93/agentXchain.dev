# Release Notes

## User Impact

### Checkpoint Runtime Identity Metadata (M3 #3)

Turn checkpoints now include the runtime identity of the model that produced the turn. This enables operators and governance tools to trace which runtime (e.g., `local-opus-4.6`, `local-gpt-5.4`) produced each checkpointed turn across all three persistence surfaces:

1. **State tracking** — `state.json` `last_completed_turn` now includes `runtime_id`, making the producing runtime queryable for the currently accepted turn.

2. **Event stream** — `turn_checkpointed` events now include `runtime_id` in the `turn` object, enabling event-driven tools to attribute checkpoints to specific runtimes.

3. **Git history** — Checkpoint commit subjects now include `runtime=<id>`, making `git log --oneline` immediately show which runtime produced each turn (e.g., `checkpoint: turn_abc123 (role=dev, phase=implementation, runtime=local-opus-4.6)`).

Legacy accepted-history entries without `runtime_id` are handled gracefully: `null` in structured JSON fields, `(unknown)` in commit subject strings. No backfill of historical entries is needed.

## Verification Summary

- 573 tests pass across 11 independently verified test suites, 0 failures
  - checkpoint-turn.test.js: 12 pass (2 new: runtime-bearing checkpoint + legacy fallback)
  - dispatch-bundle-decision-history.test.js: 10 pass
  - governed-state.test.js: 99 pass
  - dispatch-bundle.test.js: 74 pass
  - turn-result-validator.test.js: 100 pass
  - staged-result-proof.test.js: 14 pass
  - continuous-run.test.js: 87 pass
  - local-cli-adapter.test.js: 46 pass
  - vision-reader.test.js: 36 pass
  - claude-local-auth-smoke-probe.test.js: 8 pass
  - config-schema + timeout-evaluator + run-loop + release-notes-gate: 87 pass
- Checkpoint runtime identity acceptance contract: all 8 criteria verified (see acceptance-matrix.md)
- `agentxchain.json` confirmed unmodified via git diff
- No reserved `.agentxchain/` file modifications by dev

## Upgrade Notes

No breaking changes. The `runtime_id` field is additive to `last_completed_turn` in state.json and to `turn_checkpointed` events. The checkpoint commit subject format change is backward-compatible — existing tooling that parses `(role=..., phase=...)` will see an additional `runtime=...` field.

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs. Confirmed across 12 consecutive QA runs.
- M1 item #5 (10 consecutive zero-ghost runs) is longitudinal, tracked at 3/10.
- M2 item #5 (5+ consecutive runs without idle-stopping) is longitudinal, tracked at 1/5.
- M3 items #4 and #5 (cross-model challenge quality, 3 consecutive full cycles) remain open.
