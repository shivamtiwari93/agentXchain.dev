# Schedule-Owned Continuous Mode — Spec

> `DEC-SCHEDULE-CONTINUOUS-001`

## Purpose

Unify the two repo-local lights-out surfaces without creating a second scheduler:

- `agentxchain run --continuous --vision <path>` already proves vision-driven autonomous execution.
- `agentxchain schedule daemon` already owns repo-local polling, blocked-run continuation, and injected-priority pickup.

The next slice is not "call the continuous loop from the daemon." That would be a bad boundary. `executeContinuousRun()` is itself a long-running polling loop with sleep ownership; embedding it inside `schedule daemon` would create nested cadence control, hide daemon heartbeats for long stretches, and starve other schedules.

This spec freezes the correct contract:

- the **daemon owns the outer poll loop**
- continuous mode is refactored into a **single-step advance primitive**
- schedule entries may opt into a **schedule-owned continuous session**
- blocked recovery and injected `p0` work continue to flow through the existing daemon contract

This is still repo-local. It does not introduce hosted orchestration or coordinator fan-out.

## Interface

### Config

Existing schedule entries may declare an optional `continuous` block:

```json
{
  "schedules": {
    "vision_autopilot": {
      "enabled": true,
      "every_minutes": 60,
      "auto_approve": true,
      "max_turns": 10,
      "initial_role": "pm",
      "trigger_reason": "schedule:vision_autopilot",
      "continuous": {
        "enabled": true,
        "vision_path": ".planning/VISION.md",
        "max_runs": 100,
        "max_idle_cycles": 8,
        "triage_approval": "auto"
      }
    }
  }
}
```

### Continuous Schedule Fields

| Field | Type | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | no | `false` | Opt the schedule into continuous mode |
| `vision_path` | string | yes when enabled | none | Project-relative or absolute path to the governed project's VISION file |
| `max_runs` | integer >= 1 | no | `50` | Max governed runs before the session exits terminally |
| `max_idle_cycles` | integer >= 1 | no | `5` | Max daemon polls with no queued or vision-derived work before terminal idle exit |
| `triage_approval` | `"auto"` or `"human"` | no | `"auto"` | Whether vision-seeded intents are auto-approved or pause for human triage |

### State

`.agentxchain/continuous-session.json` remains the source of truth for the active session and gains schedule ownership metadata:

```json
{
  "session_id": "cont_123",
  "status": "running",
  "vision_path": ".planning/VISION.md",
  "runs_completed": 2,
  "max_runs": 100,
  "idle_cycles": 0,
  "max_idle_cycles": 8,
  "owner_type": "schedule",
  "owner_id": "vision_autopilot",
  "current_vision_objective": "human-readable goal"
}
```

`.agentxchain/schedule-state.json` remains the daemon-owned schedule ledger and records:

- `last_continuous_session_id`
- `last_status: "continuous_running" | "continuous_blocked" | "continuous_completed" | "continuous_idle_exit" | "continuous_failed"`

### Library Boundary

The shared single-step primitive:

```js
await advanceContinuousRunOnce(context, session, continuousOptions, executeGovernedRun, log)
```

Return shape:

```json
{
  "ok": true,
  "status": "running",
  "action": "started_run",
  "run_id": "run_123",
  "intent_id": "intent_456",
  "stop_reason": null
}
```

Valid `status` values: `running`, `blocked`, `completed`, `idle_exit`, `failed`.

Valid `action` examples: `max_runs_reached`, `max_idle_reached`, `vision_missing`, `no_work_found`, `waited_for_human`, `seeded_from_vision`, `started_run`, `run_blocked`, `consumed_injected_priority`, `prepare_failed`, `resolve_failed`, `vision_scan_error`.

`executeContinuousRun()` continues to exist as the CLI-owned wrapper for `run --continuous`, reimplemented on top of repeated `advanceContinuousRunOnce()` calls.

## Behavior

### 1. Daemon remains the only poll/sleep owner

- `schedule daemon` keeps its current `--poll-seconds` cadence and heartbeat/state-file semantics.
- The daemon does **not** call a long-running nested continuous loop.
- Each daemon poll may advance a schedule-owned continuous session at most once per matching schedule entry.

### 2. Continuous schedule launch

- A schedule entry with `continuous.enabled !== true` behaves exactly as it does today.
- A schedule entry with `continuous.enabled === true` starts a schedule-owned continuous session when:
  - the schedule is due
  - there is no other active continuous session owned by that schedule
  - the repo is eligible for schedule-owned work
- The schedule's `every_minutes` controls session start or restart cadence after terminal completion, not every individual governed run inside the session.
- If multiple schedule entries enable `continuous`, selection follows this order:
  1. the active non-terminal session owner, if one exists
  2. otherwise the first due continuous entry in declaration order
  3. otherwise no continuous session is advanced on that poll

### 3. Continuous schedule advancement

On each daemon poll, for a schedule-owned active continuous session:

1. Continue a schedule-owned active or unblocked governed run if one exists.
2. If the run yielded `priority_preempted`, consume the existing marker first.
3. If no queued work is ready, seed one candidate intent from `vision_path`.
4. Consume work through the real intake lifecycle:
   - `planIntent()`
   - `startIntent()`
   - governed run execution
   - `resolveIntent()`
5. Persist continuous session state after each step.

The daemon must continue advancing the session on later polls even when the schedule is not "due" again yet. Due-ness gates session creation, not session continuation.

When the daemon is managing any `continuous.enabled` schedules, sibling continuous entries must **not** leak into the normal due-schedule execution path on the same poll. A continuous-enabled schedule is always owned by the continuous-session manager:

- the selected active/due continuous owner advances through `advanceContinuousRunOnce(...)`
- other continuous-enabled siblings wait for a later poll and never appear as normal `action: "ran"` schedule executions
- once the active owner's session reaches a terminal state and is no longer due, the next due continuous-enabled sibling may start its own schedule-owned session

### 4. Blocked recovery

- If a schedule-owned continuous session blocks on `needs_human`, the daemon records `continuous_blocked` and keeps polling.
- After the operator runs the surfaced recovery action (`agentxchain unblock <id>` for `needs_human`, `agentxchain reissue-turn --reason ghost|stale` for retained ghost/stale turns), the next poll resumes the same session within one polling interval.
- The daemon does not require a second operator command such as re-running `run --continuous`.

### 5. Priority injection precedence

- If a schedule-owned continuous run yields `priority_preempted`, the daemon consumes the injected `p0` before any new vision seeding.
- Vision seeding is fallback work discovery, not a license to ignore explicit human priority.

### 6. Operator visibility

`agentxchain status` and `agentxchain schedule status` must remain truthful:

- active schedule-owned continuous session
- owner schedule id
- current vision objective
- runs completed / max runs
- blocked vs running vs idle-exit vs failed

### 7. Provenance

Runs produced inside a schedule-owned continuous session keep the existing continuous provenance:

```json
{
  "trigger": "vision_scan",
  "created_by": "continuous_loop"
}
```

Schedule ownership is tracked in session/schedule state, not by lying about run provenance.

## Error Cases

| Scenario | Behavior |
| --- | --- |
| `continuous.enabled: true` without `vision_path` | config validation error |
| `triage_approval` is not `auto` or `human` | config validation error |
| daemon sees a schedule-owned session owned by another schedule id | fail closed for that schedule entry |
| `advanceContinuousRunOnce()` returns an unsupported status | mark session failed |
| `vision_path` is missing | mark session failed with clear error |
| continuous session is terminal | daemon may start a fresh session only when the schedule becomes due again |
| another schedule entry tries to start while one schedule-owned continuous session is already active | fail closed; no overlapping continuous sessions in one repo |

## Acceptance Tests

- `AT-SCHED-CONT-001`: config accepts valid `continuous` blocks and rejects invalid `vision_path` / `triage_approval` / `max_runs` combinations. ✅
- `AT-SCHED-CONT-002`: session records `owner_type: "schedule"` and `owner_id`. ✅
- `AT-SCHED-CONT-003`: daemon advances same session on subsequent calls; session_id does not change. ✅
- `AT-SCHED-CONT-004`: blocked run pauses session for later unblock resume. ✅
- `AT-SCHED-CONT-005`: priority preemption is surfaced for daemon to consume before vision seeding. ✅
- `AT-SCHED-CONT-006`: `status --json` reports owner_type, owner_id, and vision objective. ✅
- `AT-SCHED-CONT-007`: `run --continuous` and daemon-owned mode share `advanceContinuousRunOnce()` primitive. ✅
- `AT-SCHED-CONT-008`: daemon selects a due continuous schedule instead of starving later entries behind the first configured continuous block. ✅
- `AT-SCHED-CONT-009`: an active schedule-owned session keeps ownership on later polls even when another continuous entry is due. ✅
- `AT-SDH-009`: subprocess E2E — daemon `--max-cycles 2` executes two governed runs through a single schedule-owned continuous session. Session id stays stable, `runs_completed` reaches 2, intents resolve through real intake lifecycle (`planIntent` → `startIntent` → `resolveIntent`), run history carries provenance, and `schedule-state.json` records `last_continuous_session_id`. ✅
- `AT-SDH-011`: subprocess E2E — when two schedules enable `continuous`, the active/selected owner is the only one advanced on that poll; sibling continuous schedules do not leak into normal `action: "ran"` executions, and a later poll may start the next due sibling after the first session reaches terminal completion. ✅

## Open Questions

- None for this slice. Multi-repo coordinator ownership is a different problem and must not be smuggled into the repo-local scheduler contract.
