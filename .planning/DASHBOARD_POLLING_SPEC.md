# Dashboard Polling Spec

> Truthful dashboard heartbeat contract for time-based operator surfaces.

---

## Purpose

The shipped dashboard already has WebSocket invalidation for file-backed changes, but WebSocket invalidation cannot surface **time-based** state that changes without any file write:

- approval SLA reminder thresholds becoming due
- timeout elapsed values aging while a run waits for approval
- any future read-only time-pressure indicators

This spec adds a narrow dashboard polling contract so those surfaces stay truthful without turning the dashboard into a broad write surface or background scheduler.

---

## Interface

### Browser Shell

- The dashboard browser shell keeps the existing WebSocket connection for file-backed live updates.
- It also runs a **visible-tab heartbeat every 60 seconds**.
- The heartbeat calls `GET /api/poll`.
- After each successful heartbeat, the shell refreshes the active view so time-based values stay current.
- The shell skips heartbeat ticks while the tab is hidden.
- The shell fires one immediate heartbeat when the dashboard connects so stale approvals are evaluated without waiting 60 seconds.

### Bridge Endpoint

`GET /api/poll`

Response shape:

```json
{
  "ok": true,
  "polled_at": "2026-04-16T18:00:00.000Z",
  "replay_mode": false,
  "governed_project_detected": true,
  "state_available": true,
  "reminder_evaluation": {
    "reminders_sent": ["pending_phase_transition:300"],
    "notifications_emitted": 1
  }
}
```

### Boundary Rules

- `/api/poll` is a **read-mostly heartbeat endpoint** with one allowed side effect: lazy approval SLA reminder evaluation.
- `/api/poll` must not mutate governed state.
- Replay dashboards return `replay_mode: true` and never evaluate reminders.
- Missing governed config or missing state are clean no-op responses, not HTTP errors.

---

## Behavior

1. Dashboard polling is **not** a replacement for WebSocket invalidation.
2. WebSockets remain the fast path for file-backed changes.
3. Polling exists only for time-based visibility and lazy reminder evaluation.
4. Approval SLA reminders are evaluated **exactly once per heartbeat request**, via `/api/poll`.
5. The dashboard browser shell must not smear reminder side effects across every data endpoint.
6. If a heartbeat is already in flight, additional ticks are skipped.
7. When the tab becomes visible again, the shell triggers an immediate heartbeat instead of waiting for the next interval.

---

## Error Cases

1. `/api/poll` called in replay mode → return `200` with `replay_mode: true`, no reminder evaluation.
2. No governed project in the current workspace → return `200` with `governed_project_detected: false`.
3. Governed config exists but no run state yet → return `200` with `state_available: false`.
4. Heartbeat fetch fails in the browser shell → do not crash the dashboard; the next poll tick retries naturally.
5. Multiple overlapping heartbeat ticks → ignored until the current heartbeat finishes.

---

## Acceptance Tests

1. `AT-DPOLL-001`: `GET /api/poll` evaluates due approval SLA reminders once and returns heartbeat metadata.
2. `AT-DPOLL-002`: The dashboard browser shell defines a 60-second visible-tab heartbeat to `/api/poll`.
3. `AT-DPOLL-003`: The dashboard browser shell refreshes the active view after a poll tick.
4. `AT-DPOLL-004`: Replay-mode polling no-ops cleanly and does not evaluate reminders.

---

## Open Questions

1. Should future dashboard-only time-based surfaces expose their next refresh deadline in the payload? Deferred. The current slice only needs truthful polling, not countdown UX.
