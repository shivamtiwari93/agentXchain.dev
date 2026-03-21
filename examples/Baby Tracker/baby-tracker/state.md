# Baby Tracker — Current State

## Architecture

- **Status:** Phase 1 implementation mostly landed, but QA gate is still **blocked** by new P1 defects found in Turn 6.
- **Backend:** Node.js + TypeScript, Express, `better-sqlite3`, migrations `001_init.sql` and `002_token_version.sql`.
- **Auth:** `register/login/logout/forgot-password` routes are implemented; logout invalidates tokens via `token_version`.
- **Babies:** `GET/POST /babies`, `PUT/DELETE /babies/:id` implemented with caregiver access checks.
- **Frontend:** React + Vite + Tailwind app with auth screens, protected layout, baby switcher, add-baby form, and dashboard empty states.

## QA Turn 6 Outcomes

- Full suite re-run: backend tests pass (`15` tests), frontend has no automated tests yet.
- Added QA-owned edge test: `POST /auth/forgot-password` with missing email returns `400`.
- Manual unhappy-path probes executed for empty/missing input, wrong credentials, duplicate registration, unauthorized access, invalidated session token, SQL injection input, XSS payload, and network-down behavior.
- Previously open Phase 1 UI/API blockers (`BUG-001` through `BUG-005`) were verified fixed.
- New blockers filed:
  - `BUG-006` (P1): backend dev server restart crash due non-idempotent migration (`duplicate column name: token_version`).
  - `BUG-007` (P1): `PUT /babies/:id` accepts wrong type payload (`name: 123`) instead of rejecting.
  - `BUG-008`/`BUG-009` (P2): forgot-password dead link and non-functional quick-log cards.

## Open Issues

- **P1 blockers:** `BUG-006`, `BUG-007`.
- **Password reset product gap:** backend endpoint is stub-only; login page forgot-password link is non-functional.
- **Phase 2 features:** tracking/timeline/collaboration/offline are not implemented yet by roadmap.

## Next Steps

1. Backend: make migration execution idempotent with migration tracking; ensure restart-safe startup.
2. Backend: enforce strict type validation in baby update/create payloads.
3. Frontend: wire forgot-password flow and add clear feedback/next-step behavior for quick-log actions.
4. QA: re-run full regression and ship gate once P1 bugs are closed.