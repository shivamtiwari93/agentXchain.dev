# Coordinator Event Aggregation Spec

## Purpose

Provide a unified, time-ordered event stream that merges lifecycle events from all child repos in a multi-repo coordinator run into a single timeline. External consumers (dashboards, CI, monitoring) currently see only the coordinator-level `multirepo/history.jsonl` (assignment/acceptance/barrier events) or individual repo `events.jsonl` files. There is no aggregated view that shows what is happening across all repos in real time.

## Interface

### HTTP

```
GET /api/coordinator/events?type=<csv>&since=<ISO-8601>&limit=<N>&repo_id=<id>
```

Returns a JSON array of aggregated events sorted by timestamp (ascending). Each event is the original repo event object with an added `repo_id` field identifying the source repo.

Query parameters (all optional):
- `type` — comma-separated event types to include
- `since` — ISO-8601 timestamp; only events after this
- `limit` — max events to return (from end, default 100)
- `repo_id` — filter to events from a single repo

### WebSocket

When any child repo's `events.jsonl` changes, the bridge-server reads new lines and pushes them to connected WebSocket clients as:

```json
{ "type": "coordinator_event", "repo_id": "web", "event": { ... } }
```

Clients can filter via the existing subscribe mechanism by including `"coordinator_event"` in their `event_types` array. The existing `"event"` type (local repo events) remains unchanged.

### CLI

No new CLI command. The existing `agentxchain events` command reads from the local repo's `events.jsonl`. Coordinator event aggregation is a dashboard/API surface, not a CLI surface — the coordinator workspace may not have its own `events.jsonl`.

## Behavior

1. **Aggregation source**: For each repo in `agentxchain-multi.json`, resolve the repo path and read `<repo_path>/.agentxchain/events.jsonl`.

2. **Merge strategy**: Read all child repo events, tag each with `repo_id`, merge into a single array, sort by `timestamp` ascending. Ties broken by `event_id` lexicographic order (stable sort).

3. **File watching**: The bridge-server already watches `.agentxchain/` and `.agentxchain/multirepo/`. For coordinator event aggregation, it must also watch each child repo's `.agentxchain/events.jsonl`. Use per-repo file size tracking (like the existing local event streaming) to detect new lines and push only deltas via WebSocket.

4. **Lazy initialization**: Child repo watchers are only created when the bridge-server detects a valid `agentxchain-multi.json` in the workspace. If no coordinator config exists, `/api/coordinator/events` returns `404`.

5. **Resilience**: If a child repo path doesn't exist or its `events.jsonl` is missing, skip it silently. Never crash the bridge-server due to a missing child repo.

## Error Cases

| Condition | Behavior |
|-----------|----------|
| No `agentxchain-multi.json` | `/api/coordinator/events` returns 404 |
| Coordinator config invalid | Returns 500 with error message |
| Child repo path missing | Skip repo, include events from available repos |
| Child `events.jsonl` missing | Skip repo, no events contributed |
| Malformed JSONL line | Skip line, continue parsing |
| File truncated | Reset per-repo offset to 0, re-read |

## Acceptance Tests

1. `GET /api/coordinator/events` returns merged events from 2+ child repos, each tagged with `repo_id`
2. Events are sorted by timestamp ascending
3. `repo_id` filter returns only events from the specified repo
4. `type` filter works across aggregated events
5. `since` filter works across aggregated events
6. `limit` returns the last N events from the merged set
7. Missing child repo is skipped without error
8. WebSocket receives `{ type: "coordinator_event" }` messages when child repo events change
9. No coordinator config returns 404
10. Proof script exercises a real multi-repo run and verifies aggregated event ordering

## Open Questions

None. This is a straightforward extension of the existing event streaming pattern.
