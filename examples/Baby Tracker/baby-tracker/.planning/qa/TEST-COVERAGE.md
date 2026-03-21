# Test Coverage — Baby Tracker

## Coverage Map

| Feature / Area | Unit tests | Integration tests | E2E tests | Manual QA | UX audit | Status |
|---------------|-----------|------------------|----------|----------|---------|--------|
| API health endpoint | 2 Vitest tests (`GET /health`, `POST /health` edge) | — | — | curl smoke check | N/A | Covered |
| Authentication (R1) | — | 7 Vitest API tests (`backend/tests/auth.test.ts`) | — | Re-verify with QA | UI: auth screens still missing | API covered; UI not covered |
| Baby profiles (R2) | — | 5 Vitest API tests (`backend/tests/babies.test.ts`) | — | Re-verify with QA | UI: baby forms/switcher still missing | API covered; UI not covered |
| Responsive shell (R11 foundation) | — | — | — | Source inspection + build verification | Checklist run with issues logged | Failing (incomplete) |
| Frontend build integrity | — | — | — | `npm run build --workspace frontend` | Basic static review only | Covered (build), UX unverified |

## Coverage gaps

- No UI automation for auth/baby flows, 375/768/1440 rendering, keyboard flow, or focus management.
- No E2E tests for session persistence across browser restart (R1 acceptance).
- No tests for offline/server-down behavior and error states.
- Security tests (SQLi/XSS) on live HTTP should be run by QA now that routes exist.
