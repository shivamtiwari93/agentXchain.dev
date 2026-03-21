# Engineering Standards — Baby Tracker

## Purpose

This document is the engineering source of truth for how this codebase is built and reviewed. It exists to keep the team fast without accepting correctness, security, or reliability regressions.

## Current Stack

- Backend: Node.js + TypeScript + Express + SQLite (`better-sqlite3`)
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Test runner: Vitest + Supertest on backend

## Repository Structure

### Backend

- `backend/src/app.ts` wires middleware and routes.
- `backend/src/index.ts` is process startup only.
- `backend/src/routes/` contains HTTP handlers only.
- `backend/src/lib/` contains pure helpers such as auth, password, and validation logic.
- `backend/src/middleware/` contains request middleware.
- `backend/src/migrations/` contains ordered SQL migrations.

### Frontend

- `frontend/src/pages/` contains route-level screens.
- `frontend/src/components/` contains reusable UI pieces.
- `frontend/src/context/` contains shared app state providers.
- `frontend/src/lib/` contains API client and browser utilities.

## Naming Conventions

- React components and context providers use `PascalCase.tsx`.
- Backend route, middleware, and utility files use lowercase names.
- Use descriptive names that match the domain: `babies`, `auth`, `requireAuth`, `selectedBaby`.
- Avoid abbreviations unless they are standard and obvious.

## Backend Quality Bar

### Request validation

- Reject invalid types before coercion. Do not use `String(value)` on user input for required typed fields.
- Validation errors must return `400` with a specific `{ "error": "..." }` message.
- Shared validators belong in `backend/src/lib/validation.ts` or a dedicated validation module, not duplicated across routes.

### Migrations

- Migrations must be restart-safe and tracked explicitly.
- Add a `schema_migrations` table and record each applied migration.
- Never rely on rerunning raw `ALTER TABLE` statements on every startup.
- Starting the backend twice against the same database must succeed without manual cleanup.

### Auth and secrets

- Passwords must be hashed with bcrypt or argon2.
- JWTs must contain only the minimum claims required for auth.
- Production must require an explicit secret; development defaults are allowed only outside production.
- Logout semantics must be documented when using stateless tokens.

### Error handling

- Route handlers should not leak stack traces or raw database errors to clients.
- Authorization failures return `401` or `403`; validation failures return `400`; missing records return `404`.
- If a route catches errors, the response shape must stay consistent.

## Frontend Quality Bar

- Every screen needs loading, empty, error, and success behavior where applicable.
- No dead links or no-op buttons in the main flow. If a feature is not ready, disable it and show clear copy.
- Mobile-first remains the default. The app must work at `375px`, `768px`, and `1440px` without horizontal scroll.
- Auth state changes must leave the UI in a consistent state on login, logout, and expired sessions.

## Test Expectations

- Every new backend endpoint needs happy-path and unhappy-path tests.
- Every bug fixed from `.planning/qa/BUGS.md` needs a regression test.
- Frontend Phase 1 work must add at least smoke coverage for auth routing and the dashboard empty state before Phase 1 can be called healthy.
- `npm test` must pass before a turn is released.

## Review Rules

- Engineering review blocks correctness, security, and reliability issues first.
- Cosmetic issues do not block unless they affect usability or accessibility.
- QA-raised P1 bugs must be fixed before phase sign-off.

## Commit Message Format

- Use: `Turn N - <agent> - <description>`
- Keep the description short and outcome-focused.
