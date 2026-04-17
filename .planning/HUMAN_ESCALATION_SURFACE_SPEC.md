# Human Escalation Surface Spec

**Status:** shipped  
**Decision:** `DEC-HUMAN-ESCALATION-001`  
**Created:** Turn 70 — GPT 5.4

## Purpose

Governed runs already knew how to become `blocked`, but they did not produce a first-class operator task surface. A human could see `needs_human` in `status`, but there was no durable escalation record, no repo-local `HUMAN_TASKS.md` view, and no single command that mapped a resolved blocker back into governed execution.

This slice introduces the operator floor for roadmap item 3:

- parseable human-escalation records in `.agentxchain/human-escalations.jsonl`
- managed human-readable projection in `HUMAN_TASKS.md`
- a dedicated `agentxchain unblock <id>` command
- status + notification payloads that surface the escalation id and exact unblock command

## Interface

### Files

- `.agentxchain/human-escalations.jsonl`
  - append-only event log
  - `kind: "raised"` records the open escalation
  - `kind: "resolved"` records the resolution
- `HUMAN_TASKS.md`
  - human-readable projection
  - managed sections are bounded by AgentXchain markers so surrounding human-authored content is preserved

### CLI

- `agentxchain unblock <escalation-id>`
  - valid only for governed projects
  - requires the targeted escalation id to be the current open blocker for the run
  - continues governed execution by delegating to the existing `resume` path

### Status / Notification Surface

- `agentxchain status`
  - shows the current human escalation id, type, action summary, and `agentxchain unblock <id>` command
- `run_blocked` notification payload
  - includes `payload.human_escalation` with `escalation_id`, `type`, `service`, `action`, and `resolution_command`

## Behavior

1. When a governed run enters `status = "blocked"` with `blocked_reason.recovery.owner = "human"`, AgentXchain creates exactly one open escalation record for the current blocked state.
2. The escalation record classifies the blocker into one of:
   - `needs_credential`
   - `needs_oauth`
   - `needs_payment`
   - `needs_legal`
   - `needs_physical_access`
   - `needs_decision`
3. Classification is heuristic and conservative:
   - explicit OAuth/login/session language wins over generic credential language
   - credential/token/secret language maps to `needs_credential`
   - unmatched cases fall back to `needs_decision`
4. `HUMAN_TASKS.md` is rewritten from the JSONL projection after every raise or resolve event.
5. `agentxchain unblock <id>` is fail-closed:
   - it rejects unknown ids
   - it rejects stale ids that are not the current run blocker
   - it rejects non-blocked runs
6. When the blocked run is reactivated, the matching escalation record is resolved automatically with the reactivation provenance (`resume`, `resume --turn`, or `operator_unblock`).

## Error Cases

- No governed project: `unblock` exits non-zero with a governed-only error
- No `state.json`: `unblock` exits non-zero
- Run not blocked: `unblock` exits non-zero
- Escalation id not found or already resolved: `unblock` exits non-zero
- Escalation id does not match the current blocked state: `unblock` exits non-zero and shows the current blocker id
- Existing `HUMAN_TASKS.md` without managed markers: AgentXchain appends managed sections instead of overwriting the file

### Events & Notifications (added Turn 71)

- `ensureHumanEscalation()` emits `human_escalation_raised` to `.agentxchain/events.jsonl` with full escalation metadata (escalation_id, type, service, action, resolution_command, detail).
- `resolveHumanEscalation()` emits `human_escalation_resolved` to `.agentxchain/events.jsonl` with escalation_id, type, service, resolved_via.
- Webhook notification events `human_escalation_raised` and `human_escalation_resolved` are valid subscription targets in `agentxchain.json` notifications config.
- `emitBlockedNotification()` in `governed-state.js` emits `human_escalation_raised` to webhooks when a new escalation is created (alongside the existing `run_blocked` notification).
- `reactivateGovernedRun()` emits `human_escalation_resolved` to webhooks when escalations are resolved.

### Local Notifier Floor (added Turn 71)

- `emitLocalEscalationNotice()` prints a structured stderr notice for every human escalation raise and resolve event. No config required — always fires.
- On macOS, when `AGENTXCHAIN_LOCAL_NOTIFY=1` is set, an AppleScript `display notification` is also emitted.
- `notifications.local` is a valid config key in `agentxchain.json` (reserved for future local notifier configuration).

### Events Command Display (added Turn 71)

- `agentxchain events` renders `human_escalation_raised` in red bold and `human_escalation_resolved` in green.
- `human_escalation_raised` text entries show escalation ID, type, and service inline.
- `human_escalation_resolved` text entries show escalation ID and resolved_via inline.

## Acceptance Tests

- `AT-HESC-001`: blocked human-owned runs create one structured escalation record and a managed `HUMAN_TASKS.md` projection
- `AT-HESC-002`: `agentxchain unblock <id>` resolves the open escalation and resumes governed execution
- `AT-HESC-003`: `ensureHumanEscalation` emits `human_escalation_raised` to `events.jsonl` with full metadata
- `AT-HESC-004`: `agentxchain unblock` emits `human_escalation_resolved` to `events.jsonl`
- `AT-HESC-005`: local stderr notifier fires on escalation raise with type, action, and unblock command

## Open Questions

- Continuous auto-resume from the scheduler/daemon after `unblock` is implemented separately in the schedule daemon contract; this spec remains the operator-facing unblock surface.
