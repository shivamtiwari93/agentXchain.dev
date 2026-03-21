# Baby Tracker — Team Talk File

Canonical human-readable handoff log for all agents.

## How to write entries

Use this exact structure:

## Turn N — <agent_id> (<role>)
- Status:
- Decision:
- Action:
- Risks/Questions:
- Next owner:

---

## Turn 0 — pm (Product Manager)

- **Status:** PM kickoff complete. Scope finalized with human.
- **Decision:**
  - Target user: Parents, grandparents, nannies, caregivers of newborns and young children (including multiples).
  - MVP includes 11 requirements across 6 phases in 3 waves: (1) Foundation + Core Tracking, (2) Extended Tracking + Collaboration, (3) Offline + Ship.
  - Web-first, mobile-first responsive. Native mobile app is v2.
  - Offline-first is required but phased to Phase 5 so core tracking logic is built first.
  - Success metric: parents log events multiple times per day, every day of the week.
  - No tech stack mandated — engineering team decides.
- **Action:**
  - Wrote PROJECT.md (vision, constraints, stack direction).
  - Wrote REQUIREMENTS.md (11 requirements with acceptance criteria, phased).
  - Wrote ROADMAP.md (3 waves, 6 phases, dependency graph, decision log).
  - Wrote Phase 1 PLAN.md (deliverables per agent role, acceptance criteria, turn estimates).
  - Wrote Phase 1 TESTS.md (22 functional tests, 5 security tests, 5 edge cases).
  - Updated state.md with current architecture decisions and next steps.
- **Risks/Questions:**
  - Scope is ambitious for an MVP (11 requirements including offline-first and multi-caregiver). May need to re-evaluate if velocity is slow.
  - Conflict resolution strategy for offline sync is not yet designed — Phase 5 concern.
  - Photo upload for baby profiles intentionally deferred.
- **Next owner:** Human reviews and approves kickoff. Then Backend Engineer starts Phase 1.

---

## Turn 1 — backend (Backend Engineer)

- **Status:** Phase 1 backend scaffold complete; tests green.
- **Decision:** Use Express + TypeScript + SQLite via `better-sqlite3` with versioned `.sql` migrations applied in filename order — minimal ops footprint and matches PM’s Node/npm test bar.
- **Action:** Added root npm workspace, `backend` server (`src/index.ts`, `createApp`), `openDatabase` + `001_init.sql`, `GET /health`, Vitest integration test; initialized QA coverage/acceptance/UX docs with real rows; moved roadmap Phase 1 to In progress.
- **Risks/Questions:** Phase 1 PLAN says `POST /auth/logout` “invalidates session” — need a concrete JWT strategy (stateless vs denylist). `lock.json` had `holder: human` / `last_released_by: null`; round-robin should use `last_released_by: eng-director` before backend claims per playbook.
- **Next owner:** frontend (app shell) or eng-director (standards review), per rotation after lock release.

---
## Turn 2 — frontend (Frontend Engineer)

- **Status:** Phase 1 frontend scaffold complete; builds successfully.
- **Decision:** Used React + TypeScript + Vite + Tailwind CSS v3 (v4 requires Vite 5+ which conflicts with current Node 18 setup). Implemented a mobile-first app shell with a bottom navigation bar and a Quick Log dashboard.
- **Action:** Created `frontend` workspace, installed dependencies, configured Tailwind, built `App.tsx` with real mock data for recent activity and quick log buttons, updated root `package.json` workspaces, and updated `state.md`.
- **Risks/Questions:** The backend JWT logout semantics are still open. For frontend, stateless JWTs usually mean we just discard the token on the client. If backend needs a denylist, we should coordinate. Also, the current mock data in the UI needs to be wired up to the backend once the endpoints are ready.
- **Next owner:** qa (to review and test the app shell) or backend (to continue with auth/baby endpoints).

---
## Turn 3 — qa (QA Engineer)

- **Status:** QA gate executed; automated suite passes but Phase 1 acceptance fails.
- **Decision:** Block phase advancement until P1 gaps in auth and baby profile flows are implemented and re-tested.
- **Action:** Ran `npm test` (backend `2/2` passing; frontend has no tests yet), added edge test (`POST /health` -> `404`) in `backend/tests/health.test.ts`, executed manual API unhappy-path probes (`/auth/*`, `/babies`), and updated QA docs: `BUGS.md`, `TEST-COVERAGE.md`, `UX-AUDIT.md`, `ACCEPTANCE-MATRIX.md`, `REGRESSION-LOG.md`, `phase-1/TESTS.md`, `state.md`, `history.jsonl`.
- **Risks/Questions:** Auth/baby endpoints are entirely absent, so SQLi/XSS/error-handling checks remain blocked behind missing routes. Frontend shell does not yet meet Phase 1 UX acceptance (no auth flow, no baby switcher, no desktop sidebar, no dashboard empty state).
- **Next owner:** backend (implement R1/R2 APIs + auth middleware), then frontend (connect/auth screens + baby management UI), then QA re-test.

---

## Turn 4 — backend (Backend Engineer)

- **Status:** R1/R2 backend APIs implemented; `npm test` green (14 backend tests).
- **Decision:** JWT access tokens carry `v` = `users.token_version`; logout increments version so old tokens fail verification — real invalidation without a token store.
- **Action:** Added `002_token_version.sql`, bcrypt password hashing, `jsonwebtoken`, routes in `backend/src/routes/auth.ts` and `babies.ts`, `requireAuth` middleware, Vitest suites `auth.test.ts` / `babies.test.ts`, dev `JWT_SECRET` default in non-production; moved BUG-001/BUG-002 to fixed (pending QA verify); updated QA docs and state.
- **Risks/Questions:** `/auth/forgot-password` still logs a synthetic token only — no email. QA should re-run manual `curl` probes and security cases now that routes exist. Frontend remains the Phase 1 blocker for full R1/R2 acceptance.
- **Next owner:** frontend (wire API) or QA (verify API + matrix).

---
## Turn 5 — frontend (Frontend Engineer)

- **Status:** Phase 1 frontend requirements complete; wired to backend APIs.
- **Decision:** Used React Router for navigation, Axios for API calls with a token interceptor, and React Context for Auth and Baby state. Implemented the mobile-first layout with a bottom nav for mobile and a sidebar for desktop.
- **Action:** Created `AuthContext` and `BabyContext`. Built `Login`, `Register`, `AddBaby`, and `Dashboard` screens. Added responsive `Layout` component. Updated `vite.config.ts` to proxy `/api` to the backend. Updated `state.md`.
- **Risks/Questions:** The frontend currently stores the JWT in `localStorage` and relies on the backend invalidating tokens on logout. Password reset is just a UI stub linking to nowhere since the backend only logs the token.
- **Next owner:** qa (to verify the full Phase 1 acceptance matrix and close UI bugs).

---
## Turn 6 — qa (QA Engineer)

- **Status:** QA verification executed; prior missing-flow bugs are fixed, but Phase 1 remains blocked by new P1 defects.
- **Decision:** Hold ship/phase sign-off until backend restart reliability and payload validation issues are fixed.
- **Action:** Ran `npm test` (backend 15 tests pass, frontend has no tests), added QA edge test (`POST /auth/forgot-password` missing email -> 400), executed manual API unhappy-path checks (duplicate submit, missing fields, wrong credentials, SQLi/XSS payloads, unauthorized and invalidated-session access), checked responsive UX checklist status, and updated all QA artifacts + state files.
- **Risks/Questions:** `npm run dev --workspace backend` crashes on existing DB with `duplicate column name: token_version` (migration idempotency bug). `PUT /babies/:id` accepts wrong type (`name: 123`) and coerces to string instead of rejecting. Forgot-password UI remains a dead link, and quick-log cards are non-functional.
- **Next owner:** backend (fix BUG-006 and BUG-007), then frontend (BUG-008/BUG-009 UX gaps), then QA re-test.

---
