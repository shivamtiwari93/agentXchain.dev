# E2E Parallel Lifecycle Specification — Governed v1.1

> Validates the composed parallel-turn path: concurrent assignment, targeted acceptance, acceptance-time conflict detection, reject-and-reassign recovery, and successful retry acceptance on a rebased retained turn.

---

## Purpose

The parallel-turn implementation already has strong unit and command coverage, but it still lacks one composition proof: a full lifecycle where two turns coexist, one is accepted, the sibling conflicts, the operator chooses Path A (`reject_and_reassign`), and the retained turn is accepted on retry.

This spec proves four invariants together:

- concurrent assignment produces two durable active turns with isolated staging/dispatch paths
- acceptance targets exactly one turn and writes deterministic ordered history
- acceptance-time conflict detection persists durable conflict state instead of silently clobbering sibling work
- conflict reassign refreshes the retained turn baseline so a clean retry can be accepted against the post-conflict workspace

Without this test, the parallel slices are individually covered but not compositionally proven.

---

## Interface/Schema

This spec introduces no new protocol types. It exercises existing governed primitives:

```typescript
initializeGovernedRun(root, config)
assignGovernedTurn(root, config, roleId)
writeDispatchBundle(root, state, config, { turnId })
acceptGovernedTurn(root, config, { turnId })
rejectGovernedTurn(root, config, validationResult, { turnId, reassign: true })
```

Files observed during the test:

- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json`
- `.agentxchain/dispatch/turns/<turn_id>/PROMPT.md`
- `.agentxchain/staging/<turn_id>/turn-result.json`

---

## Behavior

### Scenario

1. Copy `examples/governed-todo-app` to a temp directory and initialize a real git repo.
2. Initialize a governed run with `max_concurrent_turns = 2` for the active phase and two authoritative roles.
3. Seed a shared baseline file in `.planning/` and commit it.
4. Assign two turns concurrently and write turn-scoped dispatch bundles for both.
5. Accept the first turn after it modifies the shared file.
6. Attempt to accept the second turn against the same shared file and assert a persisted `conflict_state`.
7. Reject the conflicted second turn with `reassign: true`.
8. Assert that the retained turn:
   - keeps the same `turn_id`
   - increments `attempt`
   - clears `conflict_state`
   - persists `conflict_context`
   - refreshes `baseline`
   - refreshes `assigned_sequence`
9. Rewrite the dispatch bundle for the retained turn and assert the retry bundle carries conflict context.
10. Simulate a rebased retry by leaving the first turn's accepted file intact and introducing only a new non-conflicting file for the second turn.
11. Accept the retry and assert that:
   - the second turn is accepted with the same `turn_id`
   - the final state has no active turns
   - history contains exactly two accepted entries in deterministic order
   - the decision ledger includes `conflict_detected` and `conflict_rejected`

### Non-goals

- This test does not exercise `human_merge`; that path already has targeted unit coverage.
- This test does not cover multi-phase routing or release CLI flows.
- This test does not shell through the CLI binary; it stays at the library layer for precise state assertions.

---

## Error Cases

1. If the second acceptance silently succeeds instead of persisting a conflict, the test must fail because conflict detection regressed.
2. If `reject_and_reassign` does not refresh the retained turn baseline/sequence, the retry acceptance must fail and the test must surface that regression explicitly.
3. If the retry bundle omits `conflict_context`, the test must fail because the agent would not receive actionable rebase guidance.
4. If the retry creates a new `turn_id`, the test must fail because Path A is defined as a retained-turn retry.
5. If the final accepted retry writes duplicate history entries or leaves the conflicted turn active, the test must fail because the acceptance transaction did not close cleanly.

---

## Acceptance Tests

1. Two authoritative turns can be assigned concurrently when `max_concurrent_turns = 2`.
2. Each concurrent turn gets its own dispatch bundle and staging path.
3. `acceptGovernedTurn(..., { turnId })` accepts exactly the targeted sibling.
4. The second acceptance persists `active_turns[turn_id].status = "conflicted"` and `conflict_state.detection_count = 1`.
5. `rejectGovernedTurn(..., { turnId, reassign: true })` preserves the same `turn_id`, increments `attempt`, and persists `conflict_context`.
6. Conflict reassign refreshes `baseline` and `assigned_sequence` before redispatch.
7. Rewriting the retry dispatch bundle includes the `## File Conflict - Retry Required` prompt section or equivalent structured conflict context.
8. A retry that adds only new non-conflicting files on top of the accepted sibling state is accepted successfully.
9. Final history order is deterministic and contains exactly the two accepted turns.
10. Final ledger includes both `conflict_detected` and `conflict_rejected`.

---

## Open Questions

1. Should a future CLI-level E2E shell test cover `reject-turn --reassign` and `accept-turn --turn <id>` as subprocesses, or is the current library-level lifecycle sufficient for v1.1?
2. Should a second parallel E2E cover the `human_merge` path, or is the current unit coverage adequate until the operator UX changes?
