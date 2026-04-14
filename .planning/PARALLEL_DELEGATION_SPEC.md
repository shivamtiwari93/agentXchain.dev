# Parallel Delegation Execution — Spec

## Purpose

Enable delegation child turns to execute concurrently when `max_concurrent_turns > 1` is configured for the current phase. This composes two existing features — delegation chains (`DEC-DELEGATION-CHAINS-001`) and parallel turns (`DEC-PARALLEL-RUN-LOOP-001`) — into a single governed capability.

Currently delegation children execute sequentially (one at a time through role resolution). When a director delegates to both `dev` and `qa`, the dev turn completes before the qa turn starts. With parallel delegation, both can dispatch concurrently if they target different roles and the phase allows concurrency.

## Interface

### Config

No new config fields. Parallel delegation uses the existing `max_concurrent_turns` field in `routing.<phase>`:

```json
{
  "routing": {
    "delivery": {
      "allowed_next_roles": ["director", "dev", "qa"],
      "max_concurrent_turns": 2
    }
  }
}
```

### Adapter Contract Extension

The `local_cli` adapter must pass `AGENTXCHAIN_TURN_ID` as an environment variable to spawned child processes. This enables agents to identify their specific turn when multiple turns are active concurrently.

```javascript
env: { ...process.env, AGENTXCHAIN_TURN_ID: turn.turn_id }
```

This is a no-op for sequential mode (only one active turn) but required for parallel mode where multiple agents need to resolve their own turn from the dispatch index.

## Behavior

### Slot-Filling with Delegations

When `max_concurrent_turns > 1` and `delegation_queue` has multiple pending entries targeting different roles:

1. `selectRole()` → role resolution finds first pending delegation, returns `to_role` (e.g., `dev`)
2. `assignTurn(dev)` → marks delegation as `active`, creates turn with `delegation_context`
3. State reloaded from disk
4. `selectRole()` → role resolution finds next pending delegation (first is now `active`), returns `to_role` (e.g., `qa`)
5. `assignTurn(qa)` → marks delegation as `active`, creates turn with `delegation_context`
6. Both dispatched concurrently via `Promise.allSettled`

### Same-Role Delegation Guard

If two delegations target the same role, only one can dispatch per parallel batch. The `triedRoles` guard in `executeParallelTurns` prevents assigning the same role twice. The second delegation executes in the next iteration. This is correct — two turns for the same role would conflict on workspace state.

### Serial Acceptance with Active Siblings

When delegation children complete concurrently, acceptance is serialized (existing lock). The first delegation accepted sees its sibling as `active` (not `completed`):

- `allDone` check returns `false` (sibling is `active`, not `completed`/`failed`)
- No `pending_delegation_review` is set yet
- No `nextPending` exists (sibling is `active`, not `pending`)
- `next_recommended_role` keeps the value from `deriveNextRecommendedRole`

When the second (last) delegation is accepted:

- `allDone` check returns `true` (both `completed` or `failed`)
- `pending_delegation_review` is set with aggregated results
- `next_recommended_role` is set to parent role
- Delegation queue entries are cleared

The `nextHistoryEntries` lookup works correctly because previously accepted delegation history is already written to disk and loaded into `historyEntries`.

### Review Turn

After all delegation children complete, the parent role receives a review turn. This works identically to sequential delegation — the only difference is the children executed concurrently instead of sequentially.

### Failure + Mixed Outcomes

If one delegation child fails and the other succeeds, the review still triggers with mixed results. The `allDone` check treats both `completed` and `failed` as terminal states. This composes correctly with `DEC-DELEGATION-FAILURE-PROOF-001`.

### Three+ Delegations with Lower Concurrency

If a director issues 3 delegations but `max_concurrent_turns: 2`:

1. Iteration 1: dispatch del-001 and del-002 concurrently
2. Both accepted. del-003 is still `pending`.
3. Iteration 2: dispatch del-003 (1 slot)
4. del-003 accepted. `allDone`. Set `pending_delegation_review`.
5. Iteration 3: dispatch review turn to parent role.

## Error Cases

1. **Two delegations to same role**: only one dispatches per parallel batch; the other waits for the next iteration. Not an error.
2. **Agent cannot identify its turn**: without `AGENTXCHAIN_TURN_ID`, a `local_cli` agent in parallel mode reads `Object.values(active_turns)[0]` — may pick the wrong turn. The env var fix resolves this.
3. **Delegation + parallel not configured**: if `max_concurrent_turns` is 1 or absent, delegations execute sequentially. No behavior change.

## Acceptance Tests

- AT-PARDEL-001: Two delegations to different roles dispatch concurrently when `max_concurrent_turns >= 2`
- AT-PARDEL-002: Both delegation children receive correct `delegation_context` (different delegation IDs, charters)
- AT-PARDEL-003: Parent review turn receives aggregated results from both children
- AT-PARDEL-004: Final run status is `completed` with role order showing concurrent children
- AT-PARDEL-005: `AGENTXCHAIN_TURN_ID` env var is passed to spawned `local_cli` agents
- AT-PARDEL-006: Proof artifacts from both delegations exist after concurrent execution

## Open Questions

None. This is a composition of two proven features with one adapter-level fix.
