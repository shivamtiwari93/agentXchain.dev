# E2E Reject/Retry Specification — Governed v1

> Validates the governed unhappy-path lifecycle for a retryable turn failure: accept prior phase work, reject an invalid staged result, redispatch the same turn with rejection context, then accept the corrected retry.

---

## Purpose

Prove that the reject/retry path works end-to-end at the library level. This is the highest-value unhappy-path complement to `.planning/E2E_SMOKE_TEST_SPEC.md` because it verifies three invariants that unit tests only cover in isolation:

- rejected staged artifacts are preserved for audit
- retry state is carried forward on the same `turn_id` with incremented `attempt`
- redispatch includes the prior rejection context so the next attempt can respond to the exact failure

Without this test, Scenario B exists only as dogfood evidence and scattered unit coverage, not as a CI-enforced lifecycle guarantee.

---

## Interface/Schema

This spec introduces no new protocol types. It exercises existing governed primitives:

```typescript
initializeGovernedRun(root, config)
assignGovernedTurn(root, config, roleId)
validateStagedTurnResult(root, state, config)
rejectGovernedTurn(root, config, validationResult, reason?)
writeDispatchBundle(root, state, config)
acceptGovernedTurn(root, config)
approvePhaseTransition(root)
```

Files observed during the test:

- `.agentxchain/state.json`
- `.agentxchain/staging/<turn_id>/turn-result.json`
- `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json`
- `.agentxchain/dispatch/turns/<turn_id>/PROMPT.md`
- `.agentxchain/dispatch/rejected/*.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `TALK.md`

---

## Behavior

### Scenario

1. Copy `examples/governed-todo-app` to a temp directory and initialize a real git repo.
2. Initialize a governed run and complete the planning turn normally.
3. Approve the planning → implementation transition.
4. Commit orchestrator-generated files so the worktree is clean before assigning the `authoritative` dev turn.
5. Assign the dev turn and write the initial dispatch bundle.
6. Stage an invalid `turn-result.json` for the dev turn.
7. Run validation and confirm it fails at the expected stage.
8. Reject the turn with a human-readable reason.
9. Assert that:
   - the same `turn_id` is retained
   - `attempt` increments from `1` to `2`
   - `current_turn.status` becomes `retrying`
   - the invalid staged file is removed
   - a rejected artifact is preserved under `.agentxchain/dispatch/rejected/`
10. Rewrite the dispatch bundle for the retry and assert that:
    - `ASSIGNMENT.json` shows `attempt: 2`
    - `PROMPT.md` contains the `Previous Attempt Failed` section
    - the rejection reason, failed stage, and validation errors appear in the retry context
11. Stage a valid corrected dev turn result.
12. Accept the retry and assert that:
    - the dev turn is accepted normally
    - the phase auto-advances to `qa`
    - history contains only accepted turns (`pm`, `dev`), not the rejected attempt
    - the decision ledger contains only accepted decisions

### Non-goals

- This test does not exercise retry exhaustion or escalation; that remains unit-tested elsewhere.
- This test does not shell through the CLI binary; it stays at the library layer for precise assertions and speed.

---

## Error Cases

1. If the initial invalid staged result accidentally passes validation, the test must fail because the retry path was not actually exercised.
2. If rejecting the invalid result clears the turn instead of preserving it as `retrying`, the test must fail because redispatch semantics were broken.
3. If the rejected artifact is not persisted, the test must fail because audit preservation regressed.
4. If the retry prompt omits rejection context, the test must fail because the agent would not receive actionable correction input.
5. If the rejected attempt appears in `history.jsonl` or `decision-ledger.jsonl`, the test must fail because reject is not an acceptance path.

---

## Acceptance Tests

1. Planning can be accepted and approved before the retry scenario begins.
2. Assigning the `authoritative` dev turn requires a clean baseline, and the test explicitly commits orchestrator files before assignment.
3. An invalid staged dev turn fails `validateStagedTurnResult()`.
4. `rejectGovernedTurn()` preserves the same `turn_id`, increments `attempt` to `2`, and sets `current_turn.status = "retrying"`.
5. Rejecting clears `.agentxchain/staging/turn-result.json`.
6. Rejecting preserves exactly one rejected artifact snapshot for the first failed attempt.
7. Rewriting the dispatch bundle after rejection produces `ASSIGNMENT.json` with `attempt = 2`.
8. Rewriting the dispatch bundle after rejection produces `PROMPT.md` containing `Previous Attempt Failed`, the rejection reason, and the failed validation stage.
9. Accepting the corrected retry creates one accepted dev history entry, not two.
10. After the corrected dev acceptance, the run auto-advances to `qa` because `implementation_complete` is verification-gated but not human-approved.

---

## Open Questions

1. Should a future unhappy-path E2E also assert escalation after retry exhaustion, or is the current unit coverage sufficient for v1?
2. Should the CLI-level `reject-turn` redispatch behavior also get a subprocess E2E, or is the current command integration coverage enough?
