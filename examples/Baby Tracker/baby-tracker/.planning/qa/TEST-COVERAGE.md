# Test Coverage — Baby Tracker

## Coverage Map

| Feature / Area | Unit tests | Integration tests | E2E tests | Manual QA | UX audit | Status |
|---------------|-----------|------------------|----------|----------|---------|--------|
| API health endpoint | 2 Vitest tests (`GET /health`, `POST /health` edge) | — | — | curl smoke check | N/A | Partially covered |
| Authentication (R1) | — | — | — | Manual API probes for missing routes (`/auth/register`, `/auth/login`) | UI audit shows missing auth screens | Failing (not implemented) |
| Baby profiles (R2) | — | — | — | Manual API probe for `/babies` route | UI audit shows missing baby forms/switcher | Failing (not implemented) |
| Responsive shell (R11 foundation) | — | — | — | Source inspection + build verification | Checklist run with issues logged | Failing (incomplete) |
| Frontend build integrity | — | — | — | `npm run build --workspace frontend` | Basic static review only | Covered (build), UX unverified |

## Coverage gaps

- No automated tests for auth, baby CRUD, session persistence, or access control.
- No UI automation for 375/768/1440 rendering, keyboard flow, or focus management.
- No tests for offline/server-down behavior and error states.
- Security tests (SQLi/XSS auth and profile flows) are blocked until relevant endpoints/components exist.
