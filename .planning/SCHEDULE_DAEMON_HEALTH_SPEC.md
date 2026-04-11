# Schedule Daemon Health Spec

> Repo-local health surface for governed scheduling.

## Purpose

`agentxchain schedule daemon` moved AgentXchain from manual invocation toward lights-out operation, but it still has a credibility gap: operators cannot tell whether the daemon is actually alive, stale, or never started without attaching to the process manually.

This slice adds a truthful repo-local health surface:

1. `.agentxchain/schedule-daemon.json` heartbeat/state file
2. `agentxchain schedule status` command for human and JSON inspection

This is a better next step than a local `watch --on git-push` surface. A `.git/refs` watcher is a narrow workstation heuristic pretending to be an event system; daemon health is a real missing capability on the path to lights-out operation.

## Non-Scope

- OS service installation (`launchd`, `systemd`, Docker, etc.)
- Auto-restart after machine reboot
- Remote or cross-repo daemon aggregation
- GitHub webhook / issue / PR event ingestion
- Lock coordination between multiple daemon processes

## Interface

### Daemon State File

**Path:** `.agentxchain/schedule-daemon.json`

**Format:**

```json
{
  "schema_version": "0.1",
  "pid": 12345,
  "started_at": "2026-04-11T14:00:00.000Z",
  "last_heartbeat_at": "2026-04-11T14:05:00.000Z",
  "last_cycle_started_at": "2026-04-11T14:05:00.000Z",
  "last_cycle_finished_at": "2026-04-11T14:05:02.000Z",
  "last_cycle_result": "ok",
  "poll_seconds": 60,
  "schedule_id": null,
  "max_cycles": null,
  "last_error": null
}
```

### CLI Command

```bash
agentxchain schedule status [--json]
```

Human-readable output must show:

- daemon state: `running`, `stale`, `not_running`, or `never_started`
- last heartbeat timestamp
- last cycle result
- poll interval
- optional warning when the heartbeat is stale

JSON output must include:

```json
{
  "ok": true,
  "state_file": ".agentxchain/schedule-daemon.json",
  "daemon": {
    "status": "running",
    "pid": 12345,
    "started_at": "2026-04-11T14:00:00.000Z",
    "last_heartbeat_at": "2026-04-11T14:05:00.000Z",
    "last_cycle_result": "ok",
    "poll_seconds": 60,
    "stale_after_seconds": 180
  }
}
```

## Behavior

1. `schedule daemon` writes the state file when it starts.
2. Each daemon cycle updates `last_heartbeat_at`, `last_cycle_started_at`, and `last_cycle_finished_at`.
3. Successful cycles record `last_cycle_result: "ok"`.
4. Failed cycles record `last_cycle_result: "error"` and populate `last_error` before exiting non-zero.
5. `schedule status` treats the daemon as `running` only when `last_heartbeat_at` is recent relative to `poll_seconds`.
6. Staleness threshold is `max(poll_seconds * 3, 30)` seconds.
7. If the state file does not exist, `schedule status` reports `never_started`.
8. If the file exists but the heartbeat is stale, `schedule status` reports `stale` instead of pretending the daemon is live.
9. `.agentxchain/schedule-daemon.json` is orchestrator-owned state and must be excluded from agent-blame surfaces while included in export/restore continuity roots.

## Error Cases

| Condition | Behavior |
|---|---|
| `schedule status` in a non-governed repo | Exit 1 with actionable error |
| state file missing | Report `never_started` |
| state file malformed | Report `not_running` with parse warning in human output and structured error in JSON |
| daemon cannot write state file | Warn and continue only if scheduling can still run; fail closed if initial daemon state cannot be recorded |
| heartbeat older than staleness threshold | Report `stale` |

## Acceptance Tests

- `AT-SDH-001`: `schedule daemon --max-cycles 1` creates `.agentxchain/schedule-daemon.json`
- `AT-SDH-002`: daemon state records `pid`, `started_at`, `last_heartbeat_at`, and `poll_seconds`
- `AT-SDH-003`: `schedule status --json` reports `running` immediately after a daemon cycle
- `AT-SDH-004`: `schedule status --json` reports `never_started` when no state file exists
- `AT-SDH-005`: stale heartbeat reports `stale`, not `running`
- `AT-SDH-006`: malformed state file is handled gracefully and does not crash the command
- `AT-SDH-007`: `.agentxchain/schedule-daemon.json` is classified as orchestrator-owned state and included in export/restore roots

## Open Questions

None. This is a narrow local health slice.
