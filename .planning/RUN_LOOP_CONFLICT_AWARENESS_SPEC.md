# Run-Loop Conflict Awareness Spec

## Purpose

The run-loop must classify acceptance failures by `error_code` and emit typed events for conflicts instead of treating all failures as generic errors. This enables downstream surfaces (dashboard, report, audit, event stream) to distinguish conflicts from other acceptance failures.

## Current Defects

1. **Sequential mode**: `dispatchAndProcess()` returns `terminal: true` for all `!acceptResult.ok` cases, even when the resulting state is still `active` (conflict detection count < 3). This prematurely terminates the run-loop when it should continue with a different role.

2. **Both modes**: No `turn_conflicted` event is emitted. The `governed-state.js` correctly records `conflict_detected` in the decision ledger, but the run-loop event stream (consumed by dashboard, report, event subscribers) never surfaces it.

3. **History entries**: Neither mode records `error_code` or conflict metadata in `turn_history`, so the run-loop result doesn't distinguish conflicts from other failures.

## Interface

### New Event Type

```javascript
{
  type: 'turn_conflicted',
  turn,
  role: roleId,
  error_code: 'conflict',
  conflict: acceptResult.conflict,
  state: acceptResult.state,
}
```

### Updated History Entry

```javascript
{
  role: roleId,
  turn_id: turn.turn_id,
  accepted: false,
  error_code: acceptResult.error_code,  // 'conflict', 'hook_blocked', etc.
  accept_error: acceptResult.error,
  conflict: acceptResult.conflict,       // present only for conflict
}
```

### Updated Stop Reason

When acceptance fails with `error_code: 'conflict'`:
- If `acceptResult.state.status === 'blocked'` → `terminal: true, stop_reason: 'conflict_loop'`
- If `acceptResult.state.status !== 'blocked'` → `terminal: false` (loop continues)

## Behavior

### Sequential Mode (dispatchAndProcess)

1. On `!acceptResult.ok`, check `acceptResult.error_code`:
   - `'conflict'`: Emit `turn_conflicted` event. Check `acceptResult.state.status`:
     - `'blocked'` → return `{ terminal: true, stop_reason: 'conflict_loop' }`
     - otherwise → return `{ terminal: false, accepted: false }` so the main loop re-enters and tries another role
   - Other error codes: Keep existing behavior (`terminal: true, stop_reason: 'blocked'`)
2. Always include `error_code` in history entry.

### Parallel Mode (executeParallelTurns)

1. On `!acceptResult.ok`, check `acceptResult.error_code`:
   - `'conflict'`: Emit `turn_conflicted` event. Record conflict in history entry. Continue to other turns.
   - Other error codes: Keep existing behavior.
2. Stall detection: Conflicts count toward "all failed" stall detection, but the stop_reason becomes `'conflict_stall'` if all failures are conflicts.

## Error Cases

- `acceptResult` missing `error_code`: Treated as unknown error, existing behavior preserved.
- `acceptResult.conflict` undefined despite `error_code: 'conflict'`: Event still emitted with `conflict: undefined`.
- Multiple parallel turns conflicting simultaneously: Each gets its own `turn_conflicted` event.

## Acceptance Tests

- `AT-RLC-001`: Sequential conflict with `detection_count < 3` does NOT terminate the loop (returns `terminal: false`)
- `AT-RLC-002`: Sequential conflict with `detection_count >= 3` terminates with `stop_reason: 'conflict_loop'`
- `AT-RLC-003`: Parallel conflict emits `turn_conflicted` event with conflict metadata
- `AT-RLC-004`: History entry includes `error_code: 'conflict'` and conflict details
- `AT-RLC-005`: Non-conflict acceptance failure preserves existing terminal behavior
- `AT-RLC-006`: Parallel stall with all-conflict failures uses `stop_reason: 'conflict_stall'`

## Open Questions

None. The `governed-state.js` conflict contract is stable and already returns `error_code: 'conflict'` with full conflict metadata.
