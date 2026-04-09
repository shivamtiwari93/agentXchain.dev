# API Contract

## Endpoints

- `GET /api/teams`
- `POST /api/teams`
- `GET /api/teams/:teamId`
- `POST /api/teams/:teamId/members`
- `POST /api/teams/:teamId/checkins`
- `GET /api/teams/:teamId/summary`
- `GET /api/teams/:teamId/reminders`
- `POST /api/ops/prune-retention`

## Data Model

- Team: `id`, `name`, `channel`, `timezone`, `reminderHour`, `retentionDays`, `createdAt`, `members[]`
- Member: `id`, `name`, `timezone`, `slackHandle`, `createdAt`
- Checkin: `id`, `teamId`, `memberId`, `date`, `yesterday`, `today`, `blockers`, `status`, `submittedAt`

## Error Responses

All failures return JSON as `{ "error": "..." }` with truthful status codes:

- `400` for invalid payloads or invalid dates/status values
- `404` for unknown teams or members
- `409` for duplicate member names within one team
