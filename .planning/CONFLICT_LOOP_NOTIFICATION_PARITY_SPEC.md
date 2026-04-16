# Conflict-Loop Notification Parity Spec

> Ensures `run_blocked` webhook notifications fire when a conflict loop exhausts retries.

---

## Purpose

Close a notification gap in `governed-state.js`: when `acceptTurn()` detects a conflict and `detection_count >= 3`, the run transitions to `status: 'blocked'` but **no `run_blocked` webhook notification is emitted**. Every other block path in `governed-state.js` calls `emitBlockedNotification()`. The conflict-loop path does not.

This means operators who subscribe to `run_blocked` webhooks are blind to conflict-loop blocks — the most operator-actionable conflict outcome (human must resolve the file overlap).

---

## Design Decision

`turn_conflicted` should **NOT** become its own notification event type. Rationale:

1. Individual conflict detections are **recoverable intermediate states** — the system retries with operator resolution up to 3 times.
2. Notifying on every conflict detection would be noisy for operators who configured webhooks for actionable events.
3. The operator-actionable boundary is when the conflict loop exhausts retries and the run becomes `blocked`. That is already the `run_blocked` contract.
4. The existing `VALID_NOTIFICATION_EVENTS` list is intentionally narrow (6 event types). Adding `turn_conflicted` would conflate observability events with actionable notifications.

The correct fix is: emit `run_blocked` (with `category: 'conflict_loop'`) when `detection_count >= 3`, not add a new notification event type.

---

## Interface

No new notification event types. No config changes. The fix is internal: `emitBlockedNotification()` is called at the conflict-loop block path with the existing `run_blocked` event type.

### Payload

The `run_blocked` notification payload for conflict-loop blocks:

```json
{
  "category": "conflict_loop",
  "blocked_on": "human:conflict_loop:<turn_id>",
  "typed_reason": "conflict_loop",
  "owner": "human",
  "recovery_action": "Resolve the file conflict, then run agentxchain step --resume",
  "detail": "<conflict detail string>"
}
```

---

## Behavior

1. When `acceptTurn()` detects a conflict and `detection_count >= 3`:
   - Set `status: 'blocked'` (already implemented)
   - Write state (already implemented)
   - Record run history (already implemented)
   - **NEW**: Call `emitBlockedNotification()` with conflict-loop metadata
2. The notification is emitted **after** `writeState()` and `recordRunHistory()`, matching the pattern of other block paths.
3. Best-effort delivery semantics apply (same as all other notifications).

---

## Error Cases

1. No webhooks configured: `emitBlockedNotification()` returns early (existing guard).
2. Webhook delivery fails: audited in `notification-audit.jsonl`, does not block governed execution (existing behavior).

---

## Acceptance Tests

1. `AT-CONFLICT-NOTIFY-001`: When a conflict loop exhausts retries (detection_count >= 3) and webhooks are configured for `run_blocked`, a `run_blocked` notification is delivered with `category: 'conflict_loop'`.
2. `AT-CONFLICT-NOTIFY-002`: The notification payload includes `blocked_on`, `typed_reason`, `owner`, `recovery_action`, and `detail`.
3. `AT-CONFLICT-NOTIFY-003`: Single conflict detections (detection_count < 3) do NOT emit `run_blocked` notifications.

---

## Decisions

- `DEC-CONFLICT-NOTIFY-001`: `turn_conflicted` is NOT a notification event. It is a durable run event for observability (dashboard, event log, audit). The operator-actionable notification boundary is `run_blocked` with `category: 'conflict_loop'`, emitted only when conflict retries are exhausted.
