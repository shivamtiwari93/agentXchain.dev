# BUG-97 Run ID Assignment Normalization Spec

## Purpose

Allow retained staged turn results to survive governed-run identity drift when the staged result still proves it belongs to the active turn. This closes the DOGFOOD-100 blocker where the tusq.dev staged result had the correct `turn_id` but a stale `run_id` from an earlier run.

## Interface

- Input: staged `turn-result.json`, current `.agentxchain/state.json`, normalized config.
- Normalization context:
  - `runId`: authoritative `state.run_id`
  - `turnId`: active retained turn ID
  - `activeTurnRunId`: active turn's stored `run_id`, when present
- Output: normalized turn result plus `staged_result_auto_normalized` event metadata.

## Behavior

- If `turnResult.turn_id === context.turnId`, `context.runId` is present, and `context.activeTurnRunId` is absent or equal to `context.runId`, then a missing, blank, or mismatched top-level `run_id` is rewritten to `context.runId`.
- The normalizer emits:
  - `field: "run_id"`
  - `rationale: "run_id_rewritten_from_active_turn_context"`
- Assignment validation still compares normalized `run_id` to `state.run_id`.
- Prompt guidance must tell agents to copy `run_id` from the current assignment/state only, never from old reports, history, or retained staged JSON.

## Error Cases

- If staged `turn_id` is missing, schema validation fails. The normalizer must not guess ownership.
- If staged `turn_id` does not match the active turn, assignment validation fails. The normalizer must not rewrite `run_id` first.
- If active turn `run_id` exists and differs from `state.run_id`, the normalizer fails closed because state identity is internally inconsistent.
- If `state.run_id` is missing, no run identity can be authoritatively supplied.

## Acceptance Tests

- Unit: staged result with stale `run_id` and matching active `turn_id` validates successfully and records `run_id` normalization.
- Unit: staged result with stale `run_id` and mismatched `turn_id` is rejected.
- Command-chain: `agentxchain accept-turn --turn <id>` accepts a retained failed-acceptance turn whose staged JSON uses a stale `run_id` but matching `turn_id`.
- Command-chain negative: same stale `run_id` with mismatched `turn_id` remains rejected.
- Existing BUG-95 and BUG-96 staged-result normalization regressions continue to pass.
- Shipped-package tusq.dev retry resumes the retained DOGFOOD-100 turn without manual staging edits or operator `accept-turn` recovery and proceeds past the `run_id` mismatch.

## Open Questions

- None for this fix. Any future evidence of stale `turn_id` with matching run identity is a different identity-boundary bug and should remain fail-closed until separately triaged.
