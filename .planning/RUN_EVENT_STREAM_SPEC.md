# Run Event Stream Spec

> Repo-local structured event log for governed runs with CLI reader.

## Purpose

An operator running a governed project without webhooks or dashboard has no structured event observability today. The notification system only emits to external webhooks. The dashboard WebSocket only sends `invalidate` messages to browsers. There is no local, programmatic event surface.

This spec adds:
1. A **local event log** (`.agentxchain/events.jsonl`) — append-only, structured, complete
2. A **CLI reader** (`agentxchain events`) — tail, follow, filter

## Non-Scope

- Coordinator-level cross-repo event aggregation
- Webhook delivery (already covered by notification-runner.js)
- Dashboard UI changes
- Event replay / reprocessing
- Signed or authenticated event payloads

## Interface

### Event Log File

**Path:** `.agentxchain/events.jsonl`

**Format:** One JSON object per line, appended on each lifecycle transition.

```json
{
  "event_id": "evt_<hex16>",
  "event_type": "run_started",
  "timestamp": "2026-04-11T12:00:00.000Z",
  "run_id": "run_abc123",
  "phase": "planning",
  "status": "active",
  "turn": null,
  "payload": {}
}
```

### Event Types

**Lifecycle events** (superset of notification events):

| Event | Emitted When |
|-------|-------------|
| `run_started` | New governed run initialized |
| `phase_entered` | Run transitions to a new phase |
| `turn_dispatched` | Turn assigned to a role |
| `turn_accepted` | Turn accepted by governance |
| `turn_rejected` | Turn rejected by governance |
| `run_blocked` | Run enters blocked state |
| `run_completed` | Run completes successfully |
| `escalation_raised` | Operator raises escalation |
| `escalation_resolved` | Blocked escalation reactivated |
| `gate_pending` | Human approval gate activated |
| `gate_approved` | Human approves gate |

The first 6 notification events (`run_blocked`, `operator_escalation_raised`, `escalation_resolved`, `phase_transition_pending`, `run_completion_pending`, `run_completed`) map into these. `gate_pending` covers both `phase_transition_pending` and `run_completion_pending`. The new events (`run_started`, `phase_entered`, `turn_dispatched`, `turn_accepted`, `turn_rejected`, `gate_approved`) fill the lifecycle gaps.

### CLI Command

```
agentxchain events [options]
  --follow, -f    Stream events as they occur (tail -f behavior)
  --type <type>   Filter by event type (comma-separated)
  --since <time>  Show events after ISO-8601 timestamp
  --json          Output raw JSONL (default: human-readable table)
  --limit <n>     Show last N events (default: 50, 0 = all)
```

### Programmatic Export

`emitRunEvent()` is exported from `cli/src/lib/run-events.js` for use by governed-state.js and command files.

```javascript
emitRunEvent(root, eventType, { run_id, phase, status, turn, payload })
```

Returns: `{ ok: boolean, event_id: string }`

## Behavior

1. **Append-only.** Events are never modified or deleted by the runtime.
2. **Synchronous write.** `appendFileSync` — same as notification-audit.jsonl pattern.
3. **No delivery semantics.** This is a local log, not a transport. No retries, no acknowledgement.
4. **Idempotent emission.** Each event has a unique `event_id`. Duplicate calls produce duplicate entries (caller responsibility to avoid).
5. **Follow mode.** `--follow` uses `fs.watch()` on the events file with 100ms debounce (same pattern as dashboard file-watcher).
6. **Coexistence with notifications.** `emitRunEvent` is called alongside `emitNotifications`, not instead of it. They serve different purposes (local log vs external webhook).

## Error Cases

| Condition | Behavior |
|-----------|----------|
| `.agentxchain/` does not exist | Create it (same as other state files) |
| Write fails (permissions, disk full) | Log warning to stderr, do not interrupt governed operation |
| Malformed event in log | `events` command skips unparseable lines with warning |
| `--follow` on missing file | Wait for file creation, then stream |

## Acceptance Tests

- `AT-EVT-001`: `emitRunEvent` appends valid JSONL to `.agentxchain/events.jsonl`
- `AT-EVT-002`: Event contains required fields (`event_id`, `event_type`, `timestamp`, `run_id`)
- `AT-EVT-003`: `agentxchain events` reads and displays events from log file
- `AT-EVT-004`: `agentxchain events --type run_started` filters correctly
- `AT-EVT-005`: `agentxchain events --json` outputs raw JSONL
- `AT-EVT-006`: `agentxchain events --limit 5` shows only last 5 events
- `AT-EVT-007`: Write failure does not crash the governed run
- `AT-EVT-008`: Events are emitted during a governed run lifecycle (integration)

## Open Questions

None. This is a narrow, bounded slice.
