# Notification Contract Spec

> First-class governed notification boundary for AgentXchain integrations.

---

## Purpose

Expose a truthful, standardized notification surface for governed lifecycle events without overloading hook phases or forcing transport-specific plugins. Notifications are for external observability systems such as webhook relays, Slack bridges, ticket routers, and audit collectors.

This slice is intentionally narrow:

- one top-level governed config surface: `notifications`
- one concrete transport: `webhook`
- one repo-native evidence file: `.agentxchain/notification-audit.jsonl`
- only real lifecycle events already present in code

It does **not** add Slack/email/ticketing integrations directly. Those are downstream consumers of this contract.

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
        "events": [
          "run_blocked",
          "operator_escalation_raised",
          "escalation_resolved",
          "phase_transition_pending",
          "run_completion_pending",
          "run_completed"
        ],
        "timeout_ms": 5000,
        "headers": {
          "Authorization": "Bearer ${OPS_WEBHOOK_TOKEN}"
        }
      }
    ]
  }
}
```

### Config Rules

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `notifications.webhooks` | array | no | Max 8 endpoints |
| `name` | string | yes | `^[a-z0-9_-]+$`, unique within `webhooks` |
| `url` | string | yes | Absolute `http` or `https` URL |
| `events` | string[] | yes | Non-empty subset of shipped event types |
| `timeout_ms` | integer | yes | 100–30000 |
| `headers` | object | no | String values, `${ENV_VAR}` interpolation supported |
| `env` | object | no | Additional string vars used for header interpolation |

### Shipped Event Types

- `run_blocked`
- `operator_escalation_raised`
- `escalation_resolved`
- `phase_transition_pending`
- `run_completion_pending`
- `run_completed`

### Webhook Payload

```json
{
  "schema_version": "0.1",
  "event_id": "notif_abc123",
  "event_type": "run_blocked",
  "emitted_at": "2026-04-04T02:00:00.000Z",
  "project": {
    "id": "agentxchain-dev",
    "name": "AgentXchain.dev",
    "root": "/abs/path/to/repo"
  },
  "run": {
    "run_id": "run_123",
    "status": "blocked",
    "phase": "implementation"
  },
  "turn": {
    "turn_id": "turn_456",
    "role_id": "dev",
    "attempt": 2,
    "assigned_sequence": 7
  },
  "payload": {
    "category": "dispatch_error",
    "blocked_on": "dispatch:api_proxy_failure",
    "typed_reason": "dispatch_error",
    "recovery_action": "Resolve the dispatch issue, then run agentxchain step --resume"
  }
}
```

`turn` is `null` when the event is run-scoped and no retained/targeted turn exists.

---

## Behavior

1. Notifications are **best-effort and advisory**. They never block governed execution.
2. Each configured webhook matching the event type receives one HTTP `POST` with the JSON payload.
3. Delivery success means HTTP `2xx`. Any non-`2xx`, timeout, interpolation failure, or network error is recorded as a failed delivery in `.agentxchain/notification-audit.jsonl`.
4. Notifications are emitted only for real governed lifecycle transitions already present in shipped code. No aspirational event names are documented.
5. `run_blocked` fires for all blocked-state entries, including hook-caused blocks. `operator_escalation_raised` is an additional event emitted only for the explicit `agentxchain escalate` operator path.
6. `escalation_resolved` fires when a blocked run with `blocked_on` starting `escalation:` is reactivated through `step` or `resume`.
7. `phase_transition_pending` and `run_completion_pending` fire when human approval becomes required after turn acceptance.
8. `run_completed` fires for both direct completion and approval-mediated completion.

---

## Evidence

### Notification Audit

File: `.agentxchain/notification-audit.jsonl`

Each attempted delivery appends one line with:

- `event_id`
- `event_type`
- `notification_name`
- `transport`
- `delivered`
- `status_code`
- `timed_out`
- `duration_ms`
- `message`
- `emitted_at`

This file is exported by `agentxchain export` and verified by `agentxchain verify export`.

---

## Error Cases

1. `notifications` is not an object: config validation error.
2. `notifications.webhooks` is not an array: config validation error.
3. Unknown event name: config validation error.
4. Duplicate webhook `name`: config validation error.
5. Missing or unresolved header env var: config validation error if absent at load time; delivery failure if the environment changes before runtime.
6. HTTP timeout / connection failure / non-`2xx`: delivery recorded as failed, command still succeeds.

---

## Acceptance Tests

1. `AT-NOTIFY-001`: v4 config accepts a valid `notifications.webhooks` block.
2. `AT-NOTIFY-002`: config rejects unknown notification event names.
3. `AT-NOTIFY-003`: `markRunBlocked()` emits `run_blocked` and records `.agentxchain/notification-audit.jsonl`.
4. `AT-NOTIFY-004`: `raiseOperatorEscalation()` emits `operator_escalation_raised`.
5. `AT-NOTIFY-005`: `reactivateGovernedRun()` emits `escalation_resolved` for escalation-prefixed blocked states.
6. `AT-NOTIFY-006`: `acceptGovernedTurn()` emits `phase_transition_pending`, `run_completion_pending`, and direct `run_completed` when those outcomes occur.
7. `AT-NOTIFY-007`: `approveRunCompletion()` emits `run_completed`.
8. `AT-NOTIFY-008`: notification delivery failures are audited but do not block the operator command.
9. `AT-NOTIFY-009`: export artifacts include `.agentxchain/notification-audit.jsonl` and summary count truthfully.

---

## Open Questions

1. Should future slices add signed webhook payloads?
   - Deferred. Header auth is sufficient for the first contract slice.
2. Should notifications support retries?
   - Deferred. The shipped contract is best-effort with audit evidence, not guaranteed delivery.

---

## Decisions

- `DEC-NOTIFY-001`: Notifications are a top-level governed config surface, not another hook phase.
- `DEC-NOTIFY-002`: Webhook is the only first-class transport in the initial slice.
- `DEC-NOTIFY-003`: Delivery semantics are best-effort and never block governed execution.
- `DEC-NOTIFY-004`: `.agentxchain/notification-audit.jsonl` is the evidence file for notification delivery.
- `DEC-NOTIFY-005`: Only real lifecycle events already shipped in code are valid notification event types.
