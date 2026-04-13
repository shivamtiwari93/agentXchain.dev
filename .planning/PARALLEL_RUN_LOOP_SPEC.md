# Parallel Run Loop Spec

## Purpose

Enable `agentxchain run` (and any runner using `runLoop()`) to dispatch multiple governed turns concurrently when `max_concurrent_turns > 1` is configured for the current phase. Today, `runLoop()` processes exactly one turn per iteration — assign, dispatch, accept/reject, repeat. When parallel turns are configured, the loop should fill available concurrency slots and dispatch all active turns simultaneously.

## Interface

No new public API. The existing `runLoop(root, config, callbacks, options)` function gains parallel behavior automatically when `getMaxConcurrentTurns(config, state.phase) > 1`.

### Callback contract change

`callbacks.selectRole(state, config)` may be called **multiple times per iteration** to fill concurrency slots. Each call must return a distinct role (the one-active-turn-per-role invariant in `assignGovernedTurn` enforces this). If the callback returns `null`, slot filling stops — the loop dispatches whatever turns were assigned.

`callbacks.dispatch(context)` may be called **concurrently** for multiple turns. Each call receives a distinct `context.turn`. Implementations must be safe for concurrent invocation (no shared mutable state).

## Behavior

### Sequential mode (default, `max_concurrent_turns = 1`)

Unchanged. The loop assigns one turn, dispatches it, waits for result, accepts/rejects, loops.

### Parallel mode (`max_concurrent_turns > 1`)

Each iteration:

1. **Reload state** from disk.
2. **Check terminal conditions** (completed, blocked, paused, max_turns).
3. **Resume active turns**: collect all turns in `active_turns` with status `running` or `retrying`.
4. **Fill concurrency slots**: while `activeCount < maxConcurrent`, call `selectRole()` and `assignTurn()`. Stop filling on null role or assignment failure.
5. **Build dispatch contexts**: for each active turn (both resumed and newly assigned), write dispatch bundle (targeted by `turnId`) and build context.
6. **Dispatch concurrently**: `Promise.allSettled(contexts.map(c => callbacks.dispatch(c)))`.
7. **Process results sequentially**: for each settled dispatch, accept or reject the turn (acceptance is serialized by the lock — this is already safe). Track per-turn outcomes.
8. **Loop**: continue if not at terminal state and turns remain.

### Edge cases

- **Dispatch failure for one turn**: does not abort other turns. The failed turn is rejected; other turns proceed. If the rejection exhausts retries and blocks the run, the loop exits normally.
- **Gate pause during parallel dispatch**: if acceptance of turn N triggers a phase gate, the run enters `paused` status. The next iteration handles the gate before assigning more turns. Turns that were dispatched concurrently but not yet accepted are still in `active_turns` and will be resumed in the next iteration after the gate resolves.
- **Budget exhaustion**: if a turn's acceptance triggers budget exhaustion, the run blocks. Same behavior as sequential mode.
- **selectRole returns null early**: if only 2 of 4 concurrency slots can be filled (e.g., only 2 eligible roles), the loop dispatches those 2 concurrently. It does not wait for 4.

## Error Cases

- `selectRole` throws → run-loop returns `dispatch_error` (same as sequential)
- `dispatch` throws for all turns → run-loop returns `dispatch_error`
- `dispatch` throws for some turns → those turns are rejected, loop continues with remaining
- `assignTurn` fails for supplementary slots → slot filling stops, loop dispatches what it has
- Acceptance lock contention → handled by existing 30s lock timeout

## Acceptance Tests

- AT-PRL-001: with `max_concurrent_turns: 2` and 2 roles, both turns dispatch in the same iteration (verified by checking `turnHistory` length after first iteration)
- AT-PRL-002: with `max_concurrent_turns: 1`, behavior is identical to current sequential mode
- AT-PRL-003: if one dispatch rejects and one accepts, the accepted turn appears in history and the rejected turn is retried or escalated
- AT-PRL-004: `selectRole` returning null after filling 1 of 3 slots dispatches only 1 turn
- AT-PRL-005: gate pause interrupts parallel iteration — turns are resumed after gate approval
- AT-PRL-006: `turnsExecuted` accurately counts accepted turns across parallel iterations

## Open Questions

None. All parallel turn primitives (assignment, conflict detection, budget reservation, acceptance lock) are already implemented and tested.
