# Run Schedule Specification

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-11

## Purpose

Move AgentXchain one step closer to the human-owned vision of lights-out software factories by adding a repo-local scheduling surface that can trigger governed runs on a cadence without pretending those runs were started manually.

This slice is intentionally narrow:

- declarative schedules live in `agentxchain.json`
- due schedules can be executed on demand or by a local daemon loop
- scheduled runs use explicit `trigger: "schedule"` provenance
- blocked or already-active repos do **not** auto-recover or auto-overlap

This is a local runner capability, not hosted orchestration.

## Interface

### Config

Governed v4 config may declare an optional top-level `schedules` object keyed by schedule id:

```json
{
  "schedules": {
    "nightly_governed_run": {
      "enabled": true,
      "every_minutes": 60,
      "auto_approve": true,
      "max_turns": 10,
      "initial_role": "pm",
      "trigger_reason": "Nightly governed run"
    }
  }
}
```

### Schedule Fields

| Field | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | no | `true` | Whether the schedule is eligible to run |
| `every_minutes` | integer >= 1 | yes | none | Fixed cadence in minutes |
| `auto_approve` | boolean | no | `true` | Whether scheduled runs auto-approve gates |
| `max_turns` | integer >= 1 | no | `50` | Safety limit passed to the governed run |
| `initial_role` | string | no | config-driven | Optional first-turn role override |
| `trigger_reason` | string | no | `schedule:<id>` | Human-readable provenance reason |

### State Files

- `.agentxchain/schedule-state.json`

Shape:

```json
{
  "schema_version": "0.1",
  "schedules": {
    "nightly_governed_run": {
      "last_started_at": "2026-04-11T12:00:00.000Z",
      "last_finished_at": "2026-04-11T12:01:02.000Z",
      "last_run_id": "run_123",
      "last_status": "completed",
      "last_skip_at": null,
      "last_skip_reason": null
    }
  }
}
```

### CLI

```bash
agentxchain schedule list [--json]
agentxchain schedule run-due [--schedule <id>] [--at <iso8601>] [--json]
agentxchain schedule daemon [--poll-seconds <n>] [--max-cycles <n>] [--json]
```

## Behavior

### 1. Validation and normalization

- `schedules` is optional.
- Schedule ids must match the same lowercase id style used elsewhere: `[a-z0-9_-]+`.
- `every_minutes` must be an integer >= 1.
- `initial_role`, when present, must reference a defined role.
- Normalized governed config exposes `config.schedules`, defaulting to `{}`.

### 2. Due calculation

- A schedule with no `last_started_at` is due immediately.
- Otherwise, it becomes due when `now >= last_started_at + every_minutes`.
- The scheduler does **not** backfill missed intervals. Each due evaluation can start at most one run per schedule.

### 3. Fresh-start safety boundary

- Scheduled runs may start only when the repo state is:
  - missing
  - `idle`
  - `completed`
- Scheduled runs must **not** attach to an existing `active` or `paused` run.
- Scheduled runs must **not** restart a `blocked` run automatically.
- If the repo is `active`, `paused`, or `blocked`, the schedule is skipped and `schedule-state.json` records `last_skip_at` plus `last_skip_reason`.

### 4. Run execution

- Due schedules execute sequentially, one schedule at a time.
- A scheduled run uses the same governed run machinery as `agentxchain run`.
- Scheduled provenance must be:

```json
{
  "trigger": "schedule",
  "created_by": "operator",
  "trigger_reason": "<configured trigger_reason or schedule:<id>>"
}
```

- `initial_role`, `max_turns`, and `auto_approve` flow into the governed run execution.
- Standard run outputs remain truthful: events, history, reports, notifications, export, status, and report surfaces continue to work unchanged.

### 5. `schedule list`

- Shows every configured schedule with:
  - enabled/disabled
  - cadence
  - next due time
  - due/idle status
  - last run id and outcome when present
  - last skip reason when present

### 6. `schedule run-due`

- Evaluates due schedules once.
- `--schedule <id>` narrows execution to one configured schedule.
- `--at <iso8601>` overrides wall clock time for deterministic tests.
- Exit 0 when:
  - due schedules ran successfully
  - no schedules were due
  - schedules were skipped because the repo was active/paused/blocked
- Exit 1 when:
  - config is invalid
  - the requested schedule id does not exist
  - schedule-state persistence fails
  - a scheduled governed run fails to launch cleanly

### 7. `schedule daemon`

- Repeats `run-due` on a fixed poll interval.
- Default poll is 60 seconds.
- `--max-cycles <n>` is for deterministic tests and bounded CI proof.
- The daemon must stay alive when a schedule-owned governed run blocks on human action.
- The daemon must **not** auto-recover a blocked run by itself.
- After the operator explicitly resolves the blocker with `agentxchain unblock <id>`, the next daemon poll may continue that same schedule-owned run automatically.
- If a schedule-owned run yields with `stop_reason: "priority_preempted"`, the daemon must consume the injected `p0`, plan/start it into the same governed run, and continue that run on the next poll.
- This daemon is repo-local only. No PID management, launchctl integration, or hosted scheduler is part of this slice.

## Error Cases

| Scenario | Behavior |
| --- | --- |
| `schedules` is not an object | config validation error |
| unknown `initial_role` | config validation error |
| `every_minutes` missing or invalid | config validation error |
| `schedule run-due --schedule ghost` | print error, exit 1 |
| repo currently `active` or `paused` | skip with recorded `last_skip_reason`, exit 0 |
| repo currently `blocked` | skip with recorded `last_skip_reason`, exit 0 |
| scheduled run launch returns non-zero | record failed status in `schedule-state.json`, exit 1 |
| schedule daemon cycle hits a schedule-owned run that blocked on `needs_human` | record `last_status: "blocked"`, keep polling, wait for explicit `agentxchain unblock <id>` |
| schedule-owned run yields `priority_preempted` | record `last_status: "priority_preempted"`, consume the injected `p0`, start its governed turn, and continue on the next poll |
| schedule-state file missing/corrupt | recreate from empty state when possible; fail only on write/read errors that prevent truthful execution |

## Acceptance Tests

- `AT-SCHED-001`: governed config accepts a valid `schedules` block and normalizes defaults.
- `AT-SCHED-002`: invalid schedule config is rejected (`every_minutes`, id, or unknown `initial_role`).
- `AT-SCHED-003`: `agentxchain schedule list --json` reports due status and next due time from config + state.
- `AT-SCHED-004`: `agentxchain schedule run-due` starts an idle/completed run and the resulting run provenance trigger is `schedule`.
- `AT-SCHED-005`: `agentxchain schedule run-due` skips blocked repos instead of auto-recovering them.
- `AT-SCHED-006`: `agentxchain schedule run-due` skips active/paused repos instead of attaching to the existing run.
- `AT-SCHED-007`: `agentxchain schedule daemon --max-cycles 1` executes the same due-run path as `run-due`.
- `AT-SCHED-008`: `--schedule <id>` runs only the targeted schedule.
- `AT-SCHED-009`: `agentxchain schedule daemon` survives a schedule-owned `needs_human` block and, after `agentxchain unblock <id>`, continues that same run within one polling interval.
- `AT-SCHED-010`: `agentxchain schedule daemon` consumes an injected `p0` after `priority_preempted`, starts the injected governed turn, clears the marker, and continues the same schedule-owned run on the next poll.

## Non-Scope

- cron expression parsing
- hosted/cloud scheduling
- external calendar/webhook/event triggers
- automatic restart of blocked runs
- overlapping scheduled runs in the same repo
- schedule fan-out across coordinator child repos
- launchd/systemd installer management

## Open Questions

- None for this slice. If richer cadence syntax is needed later, that should be a separate spec instead of silently stretching `every_minutes` into a cron parser.
