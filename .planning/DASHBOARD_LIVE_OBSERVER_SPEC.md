# Dashboard Live Observer Spec

## Purpose

Make dashboard freshness explicit in the surfaces operators actually watch during active work.

The existing dashboard already had live invalidation and event streaming, but it still made operators infer freshness from indirect clues. That is weak. `Timeline` and `Cross-Repo` must show whether the view is live, stale, or disconnected, and `Cross-Repo` must react to live coordinator events without requiring a manual reload.

## Interface

### Live observer state

The dashboard app maintains a small in-memory observer state:

- `connected`
- `last_refresh_at`
- `last_run_event`
- `last_coordinator_event`

### View render contract

`Timeline` and `Cross-Repo` receive a `liveMeta` object with:

- `title`
- `freshness_state`
- `freshness_label`
- `refresh_detail`
- `connection_detail`
- `event_detail`

### Refresh routing

- `invalidate` messages refresh the active view
- `event` messages update run-event freshness metadata
- `coordinator_event` messages update coordinator-event freshness metadata
- `coordinator_event` messages must also refresh any active view that depends on coordinator history, starting with `Cross-Repo` and `Gates`

## Behavior

1. When the WebSocket connects, the dashboard marks the observer connected and performs a fresh data load.
2. Every successful data refetch updates `last_refresh_at`.
3. `Timeline` renders a live observer banner describing:
   - websocket freshness state
   - last dashboard refresh time
   - last repo-local run event seen over the websocket
4. `Cross-Repo` renders the same contract, but scoped to coordinator events.
5. If the WebSocket disconnects, the rendered freshness banner must switch to `Disconnected` without waiting for another fetch.
6. If the dashboard stays connected but `last_refresh_at` ages past the stale threshold, the banner must switch to `Stale`.
7. `Cross-Repo` must visibly update after a `coordinator_event` without relying on manual reload archaeology.

## Error Cases

- No refresh has happened yet: render a waiting/connecting freshness state, not fake "live" copy
- Invalid or missing event timestamps: fall back to observed-time text instead of crashing
- Unknown event types: preserve the raw event type in the observer text
- Coordinator workspaces with no child events yet: show the freshness banner with "No coordinator events observed yet"

## Acceptance Tests

- `AT-DLO-001`: `buildLiveMeta()` reports `Live` when connected and recently refreshed
- `AT-DLO-002`: `buildLiveMeta()` reports `Stale` when refresh age exceeds the threshold
- `AT-DLO-003`: `Timeline` renders the live observer banner with run-event visibility
- `AT-DLO-004`: `Cross-Repo` renders the live observer banner with coordinator-event visibility
- `AT-DLO-005`: dashboard websocket bridge emits `coordinator_event` messages when a child repo event file changes
- `AT-DLO-006`: app live-observer routing refreshes `Cross-Repo` for `coordinator_event` without inventing a second API

## Open Questions

- Whether the same freshness banner should later be reused in `Initiative` or `Blockers` is intentionally deferred. This slice is only for the views operators watch as a live feed.
