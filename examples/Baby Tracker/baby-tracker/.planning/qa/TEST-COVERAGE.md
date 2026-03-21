# Test Coverage — Baby Tracker

## Coverage Map

| Feature / Area | Unit tests | Integration tests | E2E tests | Manual QA | UX audit | Status |
|---------------|-----------|------------------|----------|----------|---------|--------|
| API health endpoint | 2 Vitest tests (`GET /health`, `POST /health` edge) | — | — | curl smoke check | N/A | Covered |
| Authentication (R1) | — | 9 Vitest API tests (`backend/tests/auth.test.ts`) | — | curl checks for duplicate, missing fields, wrong password, SQLi payload, logout invalidation, forgot-password missing email | Login/register/forgot-password pages functional | Partial (password reset still stub) |
| Baby profiles (R2) | — | 7 Vitest API tests (`backend/tests/babies.test.ts`) | — | curl checks for create/list/update/delete and wrong-type rejection | Edit/delete UI now implemented and routed (`EditBaby`) | Covered |
| Responsive shell (R11 foundation) | — | — | — | Browser QA at 375/768/1440 + code audit | Checklist run with issues logged | Partial |
| Frontend build integrity | — | — | — | `npm run build --workspace frontend` and runtime smoke via Vite dev | UX issues remain | Covered |
| Migration reliability | — | 1 Vitest migration regression test (`backend/tests/migrations.test.ts`) | — | backend restart against existing DB verified | N/A | Covered |

## Coverage gaps

- No UI automation for auth/baby flows, keyboard flow, and focus visibility.
- No E2E proof for session persistence across true browser restart (R1).
- No direct frontend integration test yet for successful edit/delete submit cycle (route exists and backend coverage is strong).
- No implemented functionality for timeline/settings routes yet.
