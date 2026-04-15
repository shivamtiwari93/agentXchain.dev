# Event Stream — Dashboard Integration Spec

## Purpose

Wire the existing `events.jsonl` run-event log into the dashboard bridge-server so external consumers (dashboards, CI pipelines, notification systems) can observe governed run lifecycle events in real-time via HTTP and WebSocket — without CLI polling.

## Current State

- `emitRunEvent()` appends structured events to `.agentxchain/events.jsonl` (13 event types)
- `agentxchain events --follow --json` streams JSONL via CLI file polling (200ms `watchFile`)
- Dashboard bridge-server watches `.agentxchain/` via `fs.watch()` but events.jsonl is NOT in the resource map
- WebSocket sends `{ type: "invalidate", resource }` — no event data push

## Interface

### HTTP: `GET /api/events`

Query parameters:
- `type` — comma-separated event types (e.g., `turn_accepted,phase_entered`)
- `since` — ISO-8601 timestamp; only events after this
- `limit` — max events (default 50, from end of log)
- `run_id` — filter by run ID

Response: JSON array of event objects.

### WebSocket: Event-data push

When `events.jsonl` changes, the bridge-server reads new lines and pushes actual event data to WebSocket clients:

```json
{ "type": "event", "event": { "event_id": "evt_abc123", "event_type": "turn_accepted", ... } }
```

This is in addition to the existing `{ "type": "invalidate", "resource": "/api/events" }` message.

### WebSocket: Subscribe filter (optional v1)

Clients can send a subscribe message to filter which events they receive:

```json
{ "type": "subscribe", "event_types": ["turn_accepted", "phase_entered"] }
```

Default (no subscribe): all events pushed.

## Behavior

1. `state-reader.js`: Add `events.jsonl` to `RESOURCE_MAP` and `FILE_TO_RESOURCE`
2. `bridge-server.js`: Add `/api/events` endpoint using `readRunEvents()` with query params
3. `file-watcher.js`: events.jsonl already lives in root `.agentxchain/` — adding it to the resource map is sufficient for invalidation
4. `bridge-server.js`: On events.jsonl invalidation, read new lines since last known offset and push each as `{ type: "event", event }` to all subscribed WebSocket clients
5. WebSocket clients may optionally send `{ type: "subscribe", event_types: [...] }` to filter

## Error Cases

- `events.jsonl` does not exist: `/api/events` returns `[]`, no WebSocket push
- Malformed lines in events.jsonl: skip silently (consistent with `readRunEvents`)
- WebSocket client disconnects mid-push: remove from client set (existing behavior)
- File shrinks (truncation): reset offset to 0

## Acceptance Tests

1. `GET /api/events` returns event array from events.jsonl
2. `GET /api/events?type=turn_accepted` filters correctly
3. `GET /api/events?since=<timestamp>` filters correctly
4. `GET /api/events?run_id=<id>` filters correctly
5. `GET /api/events?limit=5` returns last 5 events
6. WebSocket receives `{ type: "invalidate", resource: "/api/events" }` on file change
7. WebSocket receives `{ type: "event", event: {...} }` with actual event data on file change
8. WebSocket subscribe filter limits pushed events
9. Subprocess proof: start governed run, tail WebSocket, verify event ordering (run_started → turn_dispatched → turn_accepted → ... → run_completed)

## Open Questions

None. This is a straightforward integration of existing systems.
