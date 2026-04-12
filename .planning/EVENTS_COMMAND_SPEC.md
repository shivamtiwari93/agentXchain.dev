# Spec — `agentxchain events`

## Purpose

`events` is a repo-local event stream reader that gives operators structured visibility into governed run lifecycle without requiring webhooks or a dashboard. It reads `.agentxchain/events.jsonl` and supports filtering, limits, JSON output, and live-follow mode.

## Interface

```
agentxchain events [-f|--follow] [-t|--type <type>] [--since <timestamp>] [-j|--json] [-l|--limit <n>] [-d|--dir <path>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-f, --follow` | `false` | Stream events as they arrive (watch mode) |
| `-t, --type` | all | Comma-separated event type filter |
| `--since` | none | ISO-8601 timestamp; only events after this |
| `-j, --json` | `false` | Raw JSONL output instead of formatted |
| `-l, --limit` | `50` | Max events to show (from end); `0` = unlimited |
| `-d, --dir` | `process.cwd()` | Project directory override |

## Behavior

1. **Project root check**: walks up from `--dir` (or cwd) looking for `agentxchain.json` or `.agentxchain/state.json`. If not found → stderr error, `process.exit(1)`.
2. **Read events**: calls `readRunEvents(root, { type, since, limit })` to read `.agentxchain/events.jsonl`.
3. **Output mode**:
   - `--json`: prints each event as a JSON line
   - default: prints formatted lines with timestamp, colored event type, run ID prefix, phase, role, and type-specific detail
4. **Empty result**: if no events found and not in follow mode → prints "No events found." with filter hint if `--type` was used.
5. **Follow mode** (`-f`): after printing existing events, watches the file for new content every 200ms and prints new events as they arrive. Ctrl+C (SIGINT) stops the watcher cleanly.

### Event type rendering

- `turn_rejected`: appends reason and failed_stage from payload
- `phase_entered`: appends from → to transition and trigger
- `gate_failed`: appends from_phase → to_phase, first reason, gate_id

## Error Cases

| Condition | Result |
|-----------|--------|
| No project root found | stderr: "No AgentXchain project found", exit 1 |
| No events file exists | prints "No events found." (exit 0) |
| Malformed JSONL lines | silently skipped |

## Acceptance Tests

- `AT-EVENTS-001`: fails outside a project root
- `AT-EVENTS-002`: shows "No events found" when events.jsonl is empty/missing
- `AT-EVENTS-003`: reads and displays events from events.jsonl
- `AT-EVENTS-004`: `--type` filter restricts output to matching event types
- `AT-EVENTS-005`: `--since` filter restricts output to events after timestamp
- `AT-EVENTS-006`: `--limit` restricts output to N most recent events
- `AT-EVENTS-007`: `--json` outputs raw JSONL
- `AT-EVENTS-008`: `--type` hint shown when filtered result is empty
- `AT-EVENTS-009`: turn_rejected rendering includes reason and failed_stage
- `AT-EVENTS-010`: `--dir` flag overrides project root

## Open Questions

None.
