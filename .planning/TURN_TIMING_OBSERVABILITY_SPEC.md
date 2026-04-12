# Turn Timing Observability Spec

## Purpose

Carry per-turn timing data through the governed lifecycle so operators can see how long each turn took. Currently `started_at` exists on active turns but is dropped when turns move to history. Event payloads also lack duration.

## Gap Evidence

- `cli/src/lib/governed-state.js:2073` — active turn stores `started_at`
- `cli/src/lib/governed-state.js:2569-2594` — history entry stores `accepted_at` but NOT `started_at` or `duration_ms`
- `cli/src/lib/governed-state.js:3084-3089` — `turn_accepted` event payload has `turn_id` and `role_id` but no timing
- `cli/src/commands/status.js` — no elapsed time shown for active turns
- `cli/src/commands/history.js` — shows run-level `duration_ms` but no per-turn timing

## Interface

### History Entry (history.jsonl)

Add two fields to the history entry written at acceptance:

```json
{
  "started_at": "2026-04-12T03:00:00.000Z",
  "duration_ms": 45230,
  "accepted_at": "2026-04-12T03:00:45.230Z"
}
```

- `started_at`: copied from `currentTurn.started_at`
- `duration_ms`: computed as `new Date(accepted_at) - new Date(started_at)`
- If `currentTurn.started_at` is missing (legacy turns), `started_at` and `duration_ms` are omitted

### Event Payload (turn_accepted)

Add `started_at` and `duration_ms` to the `turn_accepted` event payload:

```json
{
  "event_type": "turn_accepted",
  "turn": { "turn_id": "...", "role_id": "..." },
  "payload": { "started_at": "...", "duration_ms": 45230 }
}
```

### Status Command (active turn display)

Show elapsed time for active turns:

```
  Turn:    turn_abc123 (dev) — running — 2m 15s elapsed
```

### History Command

No change to the table layout — run-level `duration_ms` is sufficient for the cross-run history table. Per-turn timing is available via `history --json` and `events --json`.

## Behavior

1. At turn acceptance (`acceptGovernedTurn`), read `currentTurn.started_at`
2. Compute `duration_ms = Date.now() - new Date(currentTurn.started_at).getTime()`
3. Include both `started_at` and `duration_ms` in the history entry
4. Include both in the `turn_accepted` event payload
5. At status display, compute elapsed from `activeTurn.started_at` to `Date.now()`

## Error Cases

- `currentTurn.started_at` is missing (legacy/corrupted state): omit `started_at` and `duration_ms` from history entry; omit from event payload; do not show elapsed in status
- `started_at` is not a valid ISO date: same as missing — omit gracefully

## Acceptance Tests

1. After accepting a turn, `history.jsonl` last entry has `started_at` (ISO string) and `duration_ms` (positive integer)
2. After accepting a turn, `events.jsonl` has a `turn_accepted` event with `payload.started_at` and `payload.duration_ms`
3. `status` on an active turn shows elapsed time
4. Missing `started_at` on legacy turns does not crash acceptance or status

## Open Questions

None — this is a narrow observability addition with no protocol-level implications.
