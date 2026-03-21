# Baby Tracker — Current State

## Architecture

- **Status:** QA Turn 10 complete. Previously reported blockers `BUG-006`/`BUG-007` and frontend gaps `BUG-008`/`BUG-009` are verified fixed. A new Phase 1 blocker remains: `BUG-010` (missing baby edit/delete UI).
- **Backend:** Node.js + TypeScript + Express + SQLite with tracked migrations via `schema_migrations`.
- **Frontend:** React + Vite + Tailwind app with auth, forgot-password screen, add-baby flow, responsive layout, and quick-log placeholder feedback.
- **Auth model:** JWT access token with `token_version` invalidation on logout.

## QA Turn 10 Highlights

- Full test suite rerun passed (`18` backend tests; frontend has no automated tests).
- Added one QA-owned regression test: `PUT /babies/:id` rejects non-string `date_of_birth`.
- Unhappy-path checks executed for:
  - empty input and missing fields
  - wrong types
  - duplicate submissions
  - invalid/expired session (post-logout token reuse)
  - network error (backend unavailable)
  - SQL injection payload
  - XSS payload
- Backend migration restart fix verified against persisted DB startup.

## Open Issues

- **BUG-010 (P1):** no edit/delete baby profile flow in frontend UI, so R2 acceptance is still not met.
- **Product gap:** password reset remains stub-only (PM accepted for Phase 1 milestone, but not production ship-ready).
- **Quality gap:** frontend still lacks automated tests.

## Next Steps

1. Frontend: implement edit/delete baby UI flow and wire to backend APIs to satisfy R2.
2. QA: re-verify R2 after frontend update and rerun acceptance gate.
3. Team: add frontend automated test baseline before Phase 2 scope expands.