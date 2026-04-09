# Async Standup Bot Example Spec

> B2B SaaS standup collector proving AgentXchain can govern integrations, operations, and retention-heavy product work.

## Purpose

Prove that AgentXchain can govern a B2B internal-tool workflow with a different team shape and artifact contract than both the developer-tool example (`decision-log-linter`) and the consumer SaaS example (`habit-board`).

## Interface

A Node.js HTTP application that serves:

- `GET /` — browser UI for team setup, member management, standup submission, and daily summary review
- `GET /api/teams` — list all teams with submission status for today
- `POST /api/teams` — create a team `{ name, channel, timezone?, reminderHour?, retentionDays? }`
- `GET /api/teams/:teamId` — fetch a team with members and current submission state
- `POST /api/teams/:teamId/members` — add a member `{ name, timezone, slackHandle? }`
- `POST /api/teams/:teamId/checkins` — submit or update a daily standup `{ memberId, yesterday, today, blockers?, status?, date? }`
- `GET /api/teams/:teamId/summary?date=YYYY-MM-DD` — produce the manager-facing summary for one day
- `GET /api/teams/:teamId/reminders?date=YYYY-MM-DD` — preview reminder payloads for missing members
- `POST /api/ops/prune-retention` — remove standups older than a cutoff `{ beforeDate }`

Persistence uses a JSON file under `data/standups.json`. No external services are required.

## Behavior

### Team Administration

- Teams store channel, timezone, reminder hour, retention window, and member roster.
- Members store display name, timezone, and optional Slack handle.
- Duplicate member names within one team are rejected.

### Standup Collection

- One member can have at most one standup per team per date.
- Re-submitting a standup for the same member/date updates the prior entry instead of creating duplicates.
- Status values are `green`, `yellow`, or `blocked`.

### Summary And Reminder Views

- Daily summaries show submitted members, missing members, blocker count, and a Slack-friendly markdown digest.
- Reminder previews generate one message per missing member using the team’s configured channel and reminder hour.

### Operations

- Retention pruning removes standups older than the requested cutoff date.
- Missing or corrupted data files recover to an empty store instead of crashing the app.

## Error Cases

- Creating a team with an empty name or channel returns `400`.
- Adding a member to an unknown team returns `404`.
- Adding a duplicate member name within the same team returns `409`.
- Submitting a standup for an unknown member or invalid status returns `400`/`404`.
- Retention prune without a valid `beforeDate` returns `400`.

## Acceptance Tests

- [ ] `STANDUP-001`: The server starts and serves the browser UI at `/`.
- [ ] `STANDUP-002`: Team creation and member creation work through the API.
- [ ] `STANDUP-003`: Standup submission is upserted per member/date rather than duplicated.
- [ ] `STANDUP-004`: Daily summary reports submitted members, missing members, and blockers.
- [ ] `STANDUP-005`: Reminder preview targets only missing members.
- [ ] `STANDUP-006`: Retention prune removes historical standups older than the cutoff.
- [ ] `STANDUP-007`: Invalid input returns truthful `400`/`404`/`409` responses with JSON errors.
- [ ] `STANDUP-008`: `agentxchain template validate --json` passes for the governed workflow-kit contract.

## Governed Team Shape

This example uses a B2B-delivery workflow instead of the consumer design workflow or CLI release workflow:

- **pm** (`review_only`) owns operator jobs, product scope, and acceptance truth
- **integration_lead** (`review_only`) owns Slack/reminder contracts and escalation policy
- **platform_engineer** (`authoritative`) implements APIs, persistence, and the browser UI
- **ops_manager** (`review_only`) owns runbooks, data retention, and operational recovery
- **qa** (`review_only`) audits workflow completeness and release readiness

Five roles, five phases: `planning -> integration -> implementation -> operations -> qa`.

## Open Questions

None. This example is intentionally repo-local and self-contained.
