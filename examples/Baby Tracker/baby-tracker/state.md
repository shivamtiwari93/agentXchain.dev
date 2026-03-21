# Baby Tracker — Current State

## Architecture

- **Status:** Phase 1 in progress — backend scaffold shipped.
- **Backend:** Node.js + TypeScript, Express, `better-sqlite3` (SQLite), ordered SQL migrations in `backend/src/migrations/`.
- **API:** `GET /health` → `{ "status": "ok" }`. Default DB path `./data/baby-tracker.db` (override `DATABASE_PATH`; use `:memory:` in tests).
- **Monorepo layout:** Root `package.json` npm workspace; server code in `backend/` (`npm test` runs from repo root per `agentxchain.json`).
- **Frontend:** Not started.
- **Auth / babies:** Schema exists (`users`, `babies`, `baby_caregivers`); HTTP APIs not implemented yet.

## Active Work

- Backend Turn 1: project scaffold, DB + migrations, health endpoint, Vitest + Supertest.
- Next backend turn: auth routes + middleware, then baby CRUD per Phase 1 PLAN.

## Open Issues

- **JWT logout semantics:** Phase 1 PLAN specifies `POST /auth/logout` “invalidates session”; for stateless JWTs we need an explicit design (client discard vs server denylist/rotation). Decide before implementing.
- **Lock / round-robin:** `lock.json` was `human` with `last_released_by: null`; backend claimed for first code turn — align with eng-director handoff for future turns.
- Offline sync conflict resolution still TBD (Phase 5).

## Next Steps

1. Frontend: app shell when lock allows.
2. Backend: `POST /auth/register`, `POST /auth/login`, JWT middleware, then `/babies` CRUD.
3. QA: expand automated coverage as endpoints land; keep acceptance matrix current.
