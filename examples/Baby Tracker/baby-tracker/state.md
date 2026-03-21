# Baby Tracker — Current State

## Architecture

- **Status:** Phase 1 in progress — backend auth + baby CRUD APIs implemented; frontend still needs wiring to these endpoints.
- **Backend:** Node.js + TypeScript, Express, `better-sqlite3` (SQLite), ordered SQL migrations (`001_init.sql`, `002_token_version.sql`).
- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/logout` (JWT invalidated via per-user `token_version` bump), `POST /auth/forgot-password` (stub logs reset token). Bearer JWT on protected routes.
- **Babies:** `GET/POST /babies`, `PUT/DELETE /babies/:id` — delete restricted to creator; list/update require caregiver access.
- **API:** `GET /health` unchanged. Default DB `./data/baby-tracker.db`; non-production dev default `JWT_SECRET` in `index.ts` (override in production).
- **Monorepo:** Root npm workspaces: `backend/`, `frontend/`.

## Active Work

- Backend Turn 2: Implemented R1/R2 HTTP APIs + automated tests (Vitest + Supertest).
- Next: frontend connects to auth + babies; QA re-runs matrix and closes remaining P1 UI bugs.

## Open Issues

- **BUG-003–005 (frontend):** Auth screens, baby switcher, dashboard empty state, desktop sidebar — still open until frontend turn.
- **Password reset:** `/auth/forgot-password` is a stub (console log only); real email delivery is future work.
- Offline sync conflict resolution still TBD (Phase 5).

## Next Steps

1. Frontend: auth flows + baby CRUD UI + dashboard empty state + responsive sidebar where spec requires it.
2. QA: verify API acceptance matrix; re-test BUG-003+ after UI work.
3. Backend (follow-up): refresh-token rotation or shorter JWT TTL if product wants stricter session policy.
