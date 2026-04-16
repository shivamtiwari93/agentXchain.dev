# Approval-Wait Timeout Visibility Spec

## Purpose

Prevent approval waits from becoming invisible timeout traps.

Approval-pending states (`pending_phase_transition`, `pending_run_completion`) are intentionally exempt from timeout **mutation**, but that does not mean the operator should lose visibility into elapsed phase/run time. If a run waits two days for approval and the next accepted turn immediately blocks on `timeout:run`, the product failed to warn the operator early enough.

This slice adds read-only timeout visibility during approval waits to the primary operator surfaces.

## Interface

### `agentxchain status`

When a governed run is paused on human approval and `timeouts` are configured:

- show the pending approval as today
- show `Requested:` when the pending approval carries `requested_at`
- show a timeout note explaining:
  - approval waits do not mutate timeout state
  - phase/run clocks continue during the wait
  - the next accepted turn may block if a timeout is already exceeded
- evaluate read-only timeout pressure for `phase` and `run` scopes even while the run is paused on approval
- do **not** invent turn-scoped timeout pressure when no active turn exists

### Dashboard `GET /api/timeouts`

When a governed run is paused on human approval and `timeouts` are configured:

- `live` must include phase/run exceeded/warning items exactly as they would be computed at the current wall clock
- `live_context` must describe the approval-wait state:

```json
{
  "awaiting_approval": true,
  "pending_gate_type": "phase_transition",
  "requested_at": "2026-04-16T10:00:00.000Z"
}
```

- per-turn live timeout rows remain active-run only

### Dashboard Timeouts View

When `live_context.awaiting_approval === true`, render a visible note explaining that:

- approval waits do not mutate timeout state
- phase/run clocks continue during the pause
- the next accepted turn may block if a timeout is already exceeded

## Behavior

1. Approval-pending timeout visibility is **read-only**. No governed state, ledger, or blocked status changes during `status` or `GET /api/timeouts`.
2. Approval-pending visibility covers `phase` and `run` scopes only. Turn scope requires an active turn and remains active-run only.
3. Existing `DEC-APPROVAL-TIMEOUT-EXEMPT-001` remains true: `approve-transition` and `approve-completion` do not call `evaluateTimeouts()` and do not block on timeout.
4. The new operator note must be explicit enough to prevent the false inference that approval waits pause the timeout clock.

## Error Cases

- Missing `requested_at` on the pending approval: still render the timeout note; omit the requested timestamp.
- No configured `timeouts`: no timeout note and no live timeout evaluation.
- Run state not paused on approval: preserve current active/non-active behavior.

## Acceptance Tests

- `AT-AWTV-001`: `agentxchain status` on `pending_phase_transition` with exceeded phase/run timeout shows the approval-wait timeout note and surfaces read-only timeout pressure.
- `AT-AWTV-002`: `agentxchain status` on `pending_run_completion` with configured timeouts shows `Requested:` when `requested_at` exists.
- `AT-AWTV-003`: `GET /api/timeouts` returns phase/run live timeout pressure plus `live_context.awaiting_approval` when paused on approval.
- `AT-AWTV-004`: Dashboard Timeouts view renders the approval-wait note when `live_context.awaiting_approval` is true.
- `AT-AWTV-005`: Non-approval blocked runs still return empty live arrays.

## Open Questions

None. Approval wait visibility is additive and read-only.
