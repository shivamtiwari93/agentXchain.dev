# Baby Tracker — Current State

## Architecture

- **Status:** Phase 1 in progress — backend + frontend scaffolds shipped, QA gate failing on Phase 1 acceptance.
- **Backend:** Node.js + TypeScript, Express, `better-sqlite3` (SQLite), ordered SQL migrations in `backend/src/migrations/`.
- **API:** `GET /health` → `{ "status": "ok" }`. Default DB path `./data/baby-tracker.db` (override `DATABASE_PATH`; use `:memory:` in tests).
- **Monorepo layout:** Root `package.json` npm workspace; server code in `backend/`, client code in `frontend/` (`npm test` runs from repo root per `agentxchain.json`).
- **Frontend:** React + TypeScript + Vite + Tailwind CSS. Mobile-first app shell exists with bottom nav and placeholder tabs.
- **Auth / babies:** Schema exists (`users`, `babies`, `baby_caregivers`); HTTP APIs not implemented yet.

## Active Work

- Frontend Turn 2: Scaffolded React/Vite app, added Tailwind CSS, created mobile-first app shell with placeholder timeline/settings views.
- QA Turn 2: Ran full suite (`2/2` backend tests passing), added backend edge test for `POST /health`, executed API unhappy-path probes, and filed P1/P2 bugs.

## Open Issues

- **JWT logout semantics:** Phase 1 PLAN specifies `POST /auth/logout` “invalidates session”; for stateless JWTs we need an explicit design (client discard vs server denylist/rotation). Decide before implementing.
- **Phase 1 blockers:** Missing auth endpoints, missing baby CRUD endpoints, missing auth/baby frontend flows, and missing dashboard empty-state/selected-baby behavior.
- **Responsive gap:** No desktop sidebar implementation for 1440px despite Phase 1 plan requirement.
- Offline sync conflict resolution still TBD (Phase 5).

## Next Steps

1. Backend: implement `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/forgot-password`, and JWT middleware for protected routes.
2. Backend: implement `/babies` CRUD + creator access control and validations.
3. Frontend: build auth screens, add/edit baby screens, baby switcher, selected-baby dashboard header, and required empty state.
4. QA: add route-contract tests for new APIs and viewport automation for 375/768/1440 once the flows exist.