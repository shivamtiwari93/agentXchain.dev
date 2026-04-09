# Habit Board Example Spec

> Consumer SaaS habit tracker — the second product example proving AgentXchain governs real software delivery.

## Purpose

Prove that AgentXchain can govern a consumer-facing web application with a meaningfully different team shape, workflow phases, and artifact contracts than the developer-tool example (`decision-log-linter`).

## Interface

A Node.js HTTP server that serves:

- `GET /` — static single-page frontend (HTML/CSS/JS)
- `GET /api/habits` — list all habits with streak data
- `POST /api/habits` — create a habit `{ name, color? }`
- `DELETE /api/habits/:id` — delete a habit
- `POST /api/habits/:id/check` — mark today complete
- `DELETE /api/habits/:id/check` — unmark today
- `GET /api/habits/:id/history` — 30-day completion history

Persistence: JSON file (`data/habits.json`). No external database required.

## Behavior

### Habits

- Each habit has: `id` (uuid), `name` (string, 1-100 chars), `color` (hex string, default `#6366f1`), `createdAt` (ISO string).
- Completions stored as an array of ISO date strings (date-only, no time).
- Duplicate completions for the same date are idempotent.

### Streaks

- Current streak: consecutive days ending today (or yesterday if today is not yet checked).
- Longest streak: maximum consecutive-day run in history.
- Both computed on read, not stored.

### Frontend

- Responsive card-based UI showing each habit with name, color accent, current streak, and a check/uncheck toggle for today.
- "Add Habit" form with name and optional color picker.
- Delete habit with confirmation.
- No framework dependencies (vanilla HTML/CSS/JS).

## Error Cases

- `POST /api/habits` with empty name → 400
- `POST /api/habits` with name > 100 chars → 400
- `DELETE /api/habits/:id` with unknown id → 404
- `POST /api/habits/:id/check` with unknown id → 404
- Corrupted/missing data file → recreate with empty array

## Acceptance Tests

- [ ] `HABIT-001`: Server starts and serves the frontend at `/`.
- [ ] `HABIT-002`: Create, list, and delete habits via API.
- [ ] `HABIT-003`: Check and uncheck today for a habit.
- [ ] `HABIT-004`: Streak calculation is correct for consecutive days.
- [ ] `HABIT-005`: Streak handles gaps correctly (resets to 0 or 1).
- [ ] `HABIT-006`: Duplicate check for the same date is idempotent.
- [ ] `HABIT-007`: Invalid input returns 400/404 with error JSON.
- [ ] `HABIT-008`: `agentxchain template validate --json` passes.

## Governed Team Shape

This example uses a different team than `decision-log-linter` to prove AgentXchain supports varied org structures:

- **pm** (review_only): product direction, user stories, acceptance criteria
- **designer** (review_only): UX flows, visual design decisions, accessibility
- **fullstack_dev** (authoritative): implements both frontend and backend
- **qa** (review_only): functional testing, edge cases, ship verdict

Four roles, four phases: `planning → design → implementation → qa`. No separate architecture or release phase — consumer SaaS ships faster with a leaner workflow.

## Open Questions

None. This is a self-contained example with no external dependencies.
