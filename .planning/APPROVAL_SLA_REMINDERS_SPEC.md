# Approval SLA Reminders Spec

> Notification-based reminders for stale human approvals.

---

## Purpose

When a governed run enters `pending_phase_transition` or `pending_run_completion`, the initial notification fires once (`phase_transition_pending` / `run_completion_pending`). If the human operator does not act, the approval sits silently — no follow-up, no escalation signal.

Per `DEC-APPROVAL-TIMEOUT-EXEMPT-001`, approval-pending states are exempt from timeout enforcement. Timeouts are a governance mutation mechanism; reminders are a notification mechanism. This spec adds **approval SLA reminders** as a pure notification feature: timed follow-up webhooks that remind operators to act on pending approvals without blocking or mutating the governed run.

---

## Interface

### Governed Config

```json
{
  "notifications": {
    "webhooks": [
      {
        "name": "ops-webhook",
        "url": "https://ops.example.com/agentxchain/events",
        "events": ["approval_sla_reminder", "phase_transition_pending", "run_completion_pending"],
        "timeout_ms": 5000
      }
    ],
    "approval_sla": {
      "reminder_after_seconds": [3600, 14400, 86400],
      "enabled": true
    }
  }
}
```

### Config Rules

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `notifications.approval_sla` | object | no | `null` | Omitted = no SLA reminders |
| `approval_sla.enabled` | boolean | no | `true` | Allows disabling without removing config |
| `approval_sla.reminder_after_seconds` | number[] | yes (if `approval_sla` present) | — | Ascending array of positive integers. Each value is seconds after the approval was requested. Max 10 entries. |

### Validation Rules

1. `reminder_after_seconds` must be a non-empty array of positive integers.
2. Values must be strictly ascending (no duplicates, no decreasing).
3. Maximum 10 reminder thresholds.
4. Minimum value: 300 (5 minutes). Shorter intervals are noise, not governance.
5. `approval_sla` without any webhook subscribing to `approval_sla_reminder` is a config warning (not error) — the reminders would fire but go nowhere.

### New Notification Event

**`approval_sla_reminder`** — added to `VALID_NOTIFICATION_EVENTS`.

---

## Behavior

### Evaluation Model

Approval SLA reminders are **lazily evaluated** — they fire when the governed state is inspected, not on a general background scheduler. Evaluation points:

1. **`agentxchain status`** — evaluates and fires due reminders as a side effect.
2. **Dashboard heartbeat** — the browser shell calls `GET /api/poll` immediately on connect and every 60 seconds while the tab is visible. That endpoint evaluates due reminders exactly once per poll.
3. **`agentxchain step`** — evaluates before it exits on an already-pending approval.
4. **`agentxchain run`** — evaluates when the run loop enters a pending approval gate before the operator approves or holds it.

This matches the existing architecture: reminders are tied to real operator touchpoints instead of a separate scheduler. Operators who never interact with the CLI or dashboard never trigger the lazy evaluator, which is correct — if nobody is checking, the right delivery surface is the reminder webhook itself once the next operator-facing boundary is hit.

### Reminder Logic

```
function evaluateApprovalSlaReminders(root, config, state):
  if approval_sla is not configured or not enabled: return
  if no webhooks subscribe to 'approval_sla_reminder': return

  for each pending approval (pending_phase_transition, pending_run_completion):
    requested_at = approval.requested_at
    elapsed_seconds = (now - requested_at) / 1000

    for each threshold in reminder_after_seconds:
      if elapsed_seconds >= threshold:
        reminder_key = `${approval_type}:${threshold}`
        if reminder_key not in state.sla_reminders_sent:
          emit 'approval_sla_reminder' notification
          record reminder_key in state.sla_reminders_sent
```

### Dedup Tracking

Reminder dedup state is tracked in `.agentxchain/sla-reminders.json` (not governed state). This keeps `status` read-only with respect to the governed run state file.

```json
[
  "pending_phase_transition:3600",
  "pending_phase_transition:14400"
]
```

This file is:
- Created on first reminder emission.
- Cleared per approval type when the approval is resolved (`approve-transition` / `approve-completion` call `clearSlaReminders()`).
- Not exported with the run artifact (ephemeral notification tracking, not governance evidence).

### Notification Payload

```json
{
  "schema_version": "0.1",
  "event_id": "notif_...",
  "event_type": "approval_sla_reminder",
  "emitted_at": "2026-04-16T18:00:00.000Z",
  "project": { "id": "...", "name": "...", "root": "..." },
  "run": { "run_id": "...", "status": "active", "phase": "implementation" },
  "turn": null,
  "payload": {
    "approval_type": "pending_phase_transition",
    "requested_at": "2026-04-16T14:00:00.000Z",
    "elapsed_seconds": 14400,
    "threshold_seconds": 14400,
    "reminder_index": 2,
    "total_thresholds": 3,
    "from_phase": "implementation",
    "to_phase": "qa",
    "gate": "require_approval"
  }
}
```

### Scope

- **Repo-local only** in this slice. Coordinator SLA reminders are a future extension.
- No CLI output changes — reminders are webhook-only. The `status` command already shows timeout pressure via `DEC-APPROVAL-WAIT-TIMEOUT-VISIBILITY-001`; SLA reminders are the external notification equivalent.

---

## Error Cases

1. `approval_sla` present but `reminder_after_seconds` missing or empty → config validation error.
2. `reminder_after_seconds` not strictly ascending → config validation error.
3. Value below 300 → config validation error.
4. More than 10 thresholds → config validation error.
5. `approval_sla` configured but no webhook subscribes to `approval_sla_reminder` → config validation warning.
6. Webhook delivery failure → recorded in `notification-audit.jsonl`, does not block. Reminder is still marked as sent (no retry on next evaluation).
7. `requested_at` missing from pending state (legacy state) → skip SLA evaluation, no error.

---

## Acceptance Tests

1. `AT-SLA-001`: Config validation accepts a valid `approval_sla` block with ascending positive integers ≥ 300.
2. `AT-SLA-002`: Config validation rejects non-ascending `reminder_after_seconds`.
3. `AT-SLA-003`: Config validation rejects values below 300.
4. `AT-SLA-004`: Config validation rejects more than 10 thresholds.
5. `AT-SLA-005`: `evaluateApprovalSlaReminders()` emits `approval_sla_reminder` when elapsed time crosses a threshold.
6. `AT-SLA-006`: Reminder is single-fire per threshold — second evaluation at the same threshold does not re-emit.
7. `AT-SLA-007`: `sla_reminders_sent` is cleared when approval is resolved.
8. `AT-SLA-008`: Payload includes `approval_type`, `elapsed_seconds`, `threshold_seconds`, `reminder_index`, and gate context.
9. `AT-SLA-009`: No reminders fire when `approval_sla.enabled` is `false`.
10. `AT-SLA-010`: Config warning when `approval_sla` is configured but no webhook subscribes to `approval_sla_reminder`.
11. `AT-SLA-011`: `agentxchain step` evaluates due approval SLA reminders before exiting on a pending approval.
12. `AT-SLA-012`: `runLoop()` evaluates due approval SLA reminders when it encounters a pending gate.

---

## Non-Goals

- Background daemon or cron-based evaluation (lazy evaluation is sufficient).
- Auto-escalation to a secondary approver (future feature, separate spec).
- Coordinator-level SLA aggregation (future extension).
- Repeating reminders after the last threshold (the last threshold is the final reminder; further escalation is a separate concern).

---

## Decisions

- `DEC-APPROVAL-SLA-REMINDERS-001`: Approval SLA reminders are a notification feature, not a timeout feature. They emit `approval_sla_reminder` webhook events at configured time thresholds after an approval is requested. They never block or mutate governed state. Evaluation is lazy at truthful operator touchpoints (`status`, dashboard `/api/poll`, `step`, and `run` gate handling). Scope is repo-local only.

---

## Open Questions

1. Should a future slice add an `approval_sla_escalation` event that differs from a reminder (e.g., after the last threshold, mark the approval as "stale" in the governance ledger)? Deferred — the current slice covers operator notification; escalation semantics are a separate product question.
