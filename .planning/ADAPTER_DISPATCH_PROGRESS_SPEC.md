# Adapter Dispatch Progress Streaming — Spec

**Status:** Shipped
**Author:** Claude Opus 4.6, Turn 115
**Decision:** DEC-DISPATCH-PROGRESS-001

## Purpose

Provide operators with real-time visibility into adapter activity during in-flight turn dispatch. Currently, operators can see elapsed time and remaining timeout budget but have no way to distinguish "adapter is actively working" from "adapter is stuck/silent" until the timeout fires.

## Problem

A `local_cli` dispatch with Claude Code or Codex can take 2-10 minutes. During that window:

1. `agentxchain status` shows the turn as `running` with elapsed time and budget — but no activity signal.
2. The operator cannot distinguish "adapter is producing output" from "adapter is hung."
3. The only resolution is the timeout, which may be set to 30+ minutes for legitimate long-running turns.

## Design Constraints

- **No new config surface.** Progress streaming uses the existing event infrastructure (`events.jsonl`, dashboard file-watcher, `onEvent` callbacks).
- **Best-effort.** Progress events never block or delay the governed turn. Write failures are swallowed.
- **File-based signal.** Each in-flight turn writes its own `.agentxchain/dispatch-progress-<turn_id>.json` file. The file-watcher detects changes and invalidates `/api/state`. This avoids flooding `events.jsonl` with high-frequency progress events and remains correct under parallel dispatch.
- **Adapter-specific.** Only adapters that can produce progress signals emit them. Manual adapter does not. API proxy emits a single "request in flight" / "response received" pair.

## Interface

### Progress file: `.agentxchain/dispatch-progress-<turn_id>.json`

Written by the run-command dispatch wrapper during in-flight dispatch. Overwritten on each update. Deleted when the turn completes or is rejected.

```json
{
  "turn_id": "turn_abc123",
  "runtime_id": "local-dev",
  "adapter_type": "local_cli",
  "started_at": "2026-04-17T22:00:00.000Z",
  "last_activity_at": "2026-04-17T22:03:45.000Z",
  "activity_type": "output",
  "activity_summary": "Subprocess producing output",
  "output_lines": 142,
  "stderr_lines": 3,
  "silent_since": null,
  "pid": 12345
}
```

Fields:

| Field | Type | Description |
|---|---|---|
| `turn_id` | string | Active turn ID |
| `runtime_id` | string | Runtime binding |
| `adapter_type` | string | `local_cli`, `api_proxy`, `mcp`, `remote_agent` |
| `started_at` | ISO string | When dispatch started |
| `last_activity_at` | ISO string | Last stdout/stderr output timestamp |
| `activity_type` | enum | `output` (producing), `silent` (alive but no output), `request` (API in flight), `response` (API responded) |
| `activity_summary` | string | Human-readable one-line summary |
| `output_lines` | number | Cumulative stdout lines received |
| `stderr_lines` | number | Cumulative stderr lines received |
| `silent_since` | ISO string or null | When output stopped (null if still producing) |
| `pid` | number or null | Subprocess PID (local_cli only) |

### Run event: `dispatch_progress`

Emitted to `events.jsonl` at coarse milestones only (not per output line):

- When dispatch starts
- When output resumes after a silent period > 30s
- When dispatch completes or fails

```json
{
  "event_type": "dispatch_progress",
  "turn": { "turn_id": "...", "assigned_role": "dev" },
  "payload": {
    "milestone": "started|output_resumed|completed|failed|timed_out",
    "output_lines": 142,
    "elapsed_seconds": 185,
    "silent_seconds": 0
  }
}
```

### Status command rendering

When `.agentxchain/dispatch-progress-<turn_id>.json` exists and matches the active turn:

```
  Turn:     turn_abc123
  Role:     dev (running)
  Runtime:  local-dev (local_cli)
  Elapsed:  3m 45s
  Budget:   26m 15s remaining of 30m (deadline 2:30:00 PM)
  Activity: Producing output (142 lines, last 2s ago)
```

When silent:

```
  Activity: Silent for 45s (142 lines total, last output 45s ago)
```

When no progress file exists (backwards compatible):

```
  (no Activity line — same as current behavior)
```

## Behavior

### local_cli adapter

1. **On spawn:** Write initial progress file with `activity_type: "output"`, `output_lines: 0`. Emit `dispatch_progress` event with `milestone: "started"`.
2. **On stdout/stderr data:** Update `last_activity_at`, increment line counts, clear `silent_since`. Rate-limited to one file write per second (not per chunk).
3. **On silence > 30s:** Update `activity_type: "silent"`, set `silent_since`. Emit `dispatch_progress` event with `milestone: "output_resumed"` when output resumes after this silence.
4. **On exit:** Delete progress file. Emit `dispatch_progress` event with `milestone: "completed"` or `"failed"`.

### api_proxy adapter

1. **On request start:** Write progress file with `activity_type: "request"`.
2. **On response:** Update to `activity_type: "response"`, then delete on dispatch completion.

### mcp / remote_agent adapters

Same as api_proxy — request/response lifecycle only.

### manual adapter

No progress file. Manual turns are operator-driven.

### Run-command integration

The governed engine does not write progress files directly. The `run.js` command implementation:

1. Creates one tracker per dispatched turn.
2. Passes stdout/stderr lifecycle callbacks to the adapter.
3. Writes per-turn progress files during dispatch.
4. Deletes the matching per-turn file on dispatch completion, failure, or timeout.

### Dashboard integration

The file-watcher already monitors `.agentxchain/`. When `dispatch-progress-<turn_id>.json` changes, `/api/state` is invalidated. The dashboard timeline consumes `state.dispatch_progress[turn_id]` for active turns. No separate dashboard-only endpoint is needed.

## Error Cases

- Progress file write fails → swallowed, no impact on dispatch.
- Progress file is stale (turn completed but file not deleted) → status command and `/api/state` expose progress only for active turns; stale files are ignored.
- Multiple concurrent turns → each turn writes its own `dispatch-progress-<turn_id>.json` file so parallel dispatch does not clobber progress state.

## Acceptance Tests

- `AT-PROGRESS-001`: local_cli dispatch creates `dispatch-progress.json` with correct fields during dispatch and deletes it after completion.
- `AT-PROGRESS-002`: progress file updates `last_activity_at` and `output_lines` when subprocess produces output.
- `AT-PROGRESS-003`: progress file transitions to `activity_type: "silent"` after 30s without output.
- `AT-PROGRESS-004`: `dispatch_progress` event emitted to `events.jsonl` with `milestone: "started"` at dispatch start and `milestone: "completed"` at exit.
- `AT-PROGRESS-005`: status command renders `Activity:` line when progress file exists and matches active turn.
- `AT-PROGRESS-006`: status command omits `Activity:` line when no progress file exists (backwards compatible).
- `AT-PROGRESS-007`: stale progress file (mismatched turn_id) is ignored by status command.
- `AT-PROGRESS-008`: concurrent trackers write isolated per-turn files so parallel dispatch does not overwrite another turn's progress.
- `AT-PROGRESS-009`: `/api/state` exposes `dispatch_progress` for active turns, and the dashboard timeline renders the corresponding Activity line.

## Open Questions

None — the design reuses existing infrastructure (events.jsonl, file-watcher, status command rendering) and adds one new file plus one new event type.
