# Integration Contract

## Slack Delivery Shape

The product generates manager summaries and member reminder payloads as Slack-friendly markdown/text. The example does not send them externally, but the payload format is stable enough to wire into a real notifier later.

## Team Fields

Each team records `channel`, `timezone`, `reminderHour`, and `retentionDays`. Each member records `name`, `timezone`, and optional `slackHandle`.

## Failure Handling

If a team or member is missing, the API returns structured JSON errors. Reminder previews only include missing members, never already-submitted members.
