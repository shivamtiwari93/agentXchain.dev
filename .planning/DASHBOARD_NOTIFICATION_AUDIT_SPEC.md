# Dashboard Notification Audit Spec

## Purpose

Expose recent notification delivery truth as a first-class local dashboard surface so operators do not have to open `.agentxchain/notification-audit.jsonl` by hand to see whether webhook delivery is healthy.

## Interface

### API Endpoint

`GET /api/notifications` — computed endpoint (like `/api/timeouts`), not a static file read.

**Response shape:**

```json
{
  "ok": true,
  "configured": true,
  "webhooks": [
    {
      "name": "ops_webhook",
      "timeout_ms": 5000,
      "event_count": 3,
      "events": ["run_blocked", "run_completed", "approval_sla_reminder"]
    }
  ],
  "approval_sla": {
    "enabled": true,
    "reminder_after_seconds": [3600, 14400, 86400]
  },
  "summary": {
    "total_attempts": 3,
    "delivered": 1,
    "failed": 2,
    "timed_out": 1,
    "last_emitted_at": "2026-04-19T23:00:00.000Z",
    "last_failure_at": "2026-04-19T23:00:00.000Z"
  },
  "recent": [
    {
      "event_type": "approval_sla_reminder",
      "notification_name": "ops_webhook",
      "delivered": false,
      "status_code": null,
      "timed_out": true,
      "duration_ms": 5000,
      "message": "Timed out after 5000ms",
      "emitted_at": "2026-04-19T23:00:00.000Z"
    }
  ]
}
```

**Error responses:**

- `404` with `{ ok: false, code: "config_missing" }` when project config cannot be found

### Dashboard Panel

Dashboard nav item: `Notifications`

Renders:
- Configuration status badge (`configured` / `not configured`)
- Notification target summary (`name`, `timeout`, subscribed event count)
- Approval SLA reminder summary when configured
- Delivery summary badges (`attempts`, `delivered`, `failed`, `timed out`)
- Recent delivery attempt table with newest-first rows

### Data Flow

1. Bridge server reads `agentxchain.json`
2. Extracts `notifications.webhooks` and `notifications.approval_sla`
3. Reads `.agentxchain/notification-audit.jsonl`
4. Sorts audit entries newest-first by `emitted_at`
5. Computes aggregate counts and most recent failure timestamp
6. Returns config summary plus recent delivery truth

## Behavior

1. The endpoint works even when there is no active run; notification audit is independent of `state.json`.
2. `configured` means at least one webhook exists in `notifications.webhooks`.
3. Missing audit file returns an empty `recent` array and zeroed summary fields, not an error.
4. Recent attempts are newest-first and capped at 10 rows.
5. Failed and timed-out attempts remain visible even if notifications are no longer configured; the dashboard must show current config state and historical audit truth separately.
6. The panel must not invent transport-specific semantics beyond the stored audit fields.

## Error Cases

1. No `agentxchain.json` → 404 with guidance to initialize/configure the project
2. Malformed audit JSONL → fail closed by throwing; callers surface a 500 instead of silently hiding bad audit data
3. No webhook config but historical audit exists → show `configured: false` and still render recent audit rows

## Acceptance Tests

- **AT-NOTIFY-DASH-001**: `GET /api/notifications` returns `404` with `code: "config_missing"` when config missing
- **AT-NOTIFY-DASH-002**: endpoint returns `configured: false`, zeroed summary, and empty `recent` when no notifications are configured and no audit exists
- **AT-NOTIFY-DASH-003**: endpoint returns webhook config, approval SLA config, aggregate counts, and newest-first recent audit rows
- **AT-NOTIFY-DASH-004**: dashboard panel renders a not-configured placeholder when no webhooks and no audit entries exist
- **AT-NOTIFY-DASH-005**: dashboard panel renders recent failure rows and timeout badges from audit data
- **AT-NOTIFY-DASH-006**: dashboard shell/nav/docs expose the `Notifications` view and `/api/notifications` endpoint

## Open Questions

None. This slice is read-only and uses already-shipped config plus audit files.
