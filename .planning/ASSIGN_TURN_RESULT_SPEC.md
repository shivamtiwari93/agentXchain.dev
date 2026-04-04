# Assign Turn Result Specification

## Purpose

Make the governed assignment contract usable by non-CLI consumers without forcing them to reconstruct the assigned turn from `state.active_turns` or the legacy `state.current_turn` alias.

## Interface

### Function

`assignGovernedTurn(root, config, roleId)`

### Success Result

On success, the function returns:

```js
{
  ok: true,
  state,
  turn,
  warnings?: string[],
}
```

- `state` is the updated governed state after assignment
- `turn` is the exact assigned turn object written into `state.active_turns[turn_id]`
- `warnings` remains optional and unchanged

### Failure Result

Failure results remain unchanged:

```js
{
  ok: false,
  error,
  error_code?,
  state?,
  hookResults?,
}
```

No `turn` field is added to failures. A failed assignment did not create a turn, and pretending otherwise would make caller logic sloppier.

## Behavior

- `turn.turn_id` must equal the turn created in `state.active_turns`
- `turn.assigned_role` and `turn.runtime_id` must match the assigned role/runtime
- The new result shape is additive and non-breaking for existing consumers that only read `{ ok, state }`
- The runner interface inherits this result shape because `assignTurn` re-exports `assignGovernedTurn`

## Error Cases

- Unknown role: unchanged failure contract
- Run not active or blocked: unchanged failure contract
- Hook-blocked assignment: unchanged failure contract
- Clean-baseline failure: unchanged failure contract
- Concurrency or duplicate-role rejection: unchanged failure contract

## Acceptance Tests

- `AT-ASSIGN-RESULT-001`: `assignGovernedTurn()` success returns `turn` at top level
- `AT-ASSIGN-RESULT-002`: returned `turn` matches the object stored in governed state
- `AT-ASSIGN-RESULT-003`: failure results do not gain a fake `turn`
- `AT-RUNNER-001b`: runner-interface consumers can use `assignTurn(...).turn` directly
- `AT-RUNNER-004`: programmatic lifecycle tests no longer need helper logic to rediscover the assigned turn

## Open Questions

- Whether `initializeGovernedRun()` should also grow a top-level `run_id` helper remains open. This spec intentionally fixes the recurring assignment friction first instead of widening multiple result contracts in one slice.
