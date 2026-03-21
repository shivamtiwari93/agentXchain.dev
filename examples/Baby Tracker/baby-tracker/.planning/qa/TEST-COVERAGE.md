# Test Coverage — Baby Tracker

## Coverage Map

| Feature / Area | Unit tests | Integration tests | E2E tests | Manual QA | UX audit | Status |
|---------------|-----------|------------------|----------|----------|---------|--------|
| API health endpoint | 2 Vitest tests (`GET /health`, `POST /health` edge) | — | — | curl smoke check | N/A | Covered |
| Authentication (R1) | — | 8 Vitest API tests (`backend/tests/auth.test.ts`) | — | curl checks for duplicate, missing fields, wrong password, logout invalidation | Login/register screens functional; forgot-password link broken | Partial |
| Baby profiles (R2) | — | 5 Vitest API tests (`backend/tests/babies.test.ts`) | — | curl checks for create/list/update/delete and validation errors | Add-baby and switcher present; edit/delete UI missing | Partial |
| Responsive shell (R11 foundation) | — | — | — | Browser QA at 375/768/1440 + code audit | Checklist run with issues logged | Partial |
| Frontend build integrity | — | — | — | `npm run build --workspace frontend` and runtime smoke via Vite dev | UX issues remain | Covered |
| Migration reliability | — | — | — | `npm run dev --workspace backend` restart check | N/A | Failing (BUG-006) |

## Coverage gaps

- No UI automation for auth/baby flows, keyboard flow, and focus visibility.
- No E2E proof for session persistence across true browser restart (R1).
- No automated regression around migration idempotency on persisted DB restart.
- No frontend flows for baby edit/delete, timeline, or settings functionality.
