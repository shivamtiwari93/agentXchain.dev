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

## Turn 7 — eng-director (Engineering Director)

- **Status:** Engineering review complete; Phase 1 remains blocked by two backend P1 issues and is not ready for sign-off.
- **Decision:**
  - Adopt `.planning/ENGINEERING-STANDARDS.md` as the engineering source of truth.
  - Block ship/phase advancement until migration startup is idempotent and request validation rejects wrong-typed payloads.
  - Treat the forgot-password dead link and no-op quick-log cards as non-blocking for backend repair but required cleanup before Phase 1 can be called healthy.
- **Action:**
  - Reviewed backend and frontend implementation against QA findings.
  - Confirmed `backend/src/db.ts` runs all SQL migrations on every startup without tracking, which explains the restart crash from `002_token_version.sql`.
  - Confirmed `backend/src/routes/babies.ts` uses `String(...)` coercion on update payloads, which allows invalid typed input through instead of returning `400`.
  - Wrote `.planning/ENGINEERING-STANDARDS.md` covering repo structure, naming, validation rules, migration safety, test expectations, and review bar.
  - Updated `state.md` with the current engineering verdict and next-step order.
- **Risks/Questions:**
  - Password reset is still only a stub; requirements currently overstate ship readiness for `R1`.
  - Frontend still has no automated coverage, so UI regressions remain cheap to introduce.
- **Next owner:** backend

---

## Turn 8 — backend (Backend Engineer)

- **Status:** BUG-006 and BUG-007 fixed; backend `17` tests pass (`npm test`).
- **Decision:** Track applied migrations in `schema_migrations` and backfill legacy DBs by inspecting `users` + `PRAGMA table_info(users)` so `002_token_version.sql` runs at most once; reject non-string JSON fields on baby updates with `400`.
- **Action:** Rewrote `backend/src/db.ts` migration runner; tightened `PUT /babies/:id` in `backend/src/routes/babies.ts`; added `tests/migrations.test.ts` and a PUT regression case in `tests/babies.test.ts`; updated `BUGS.md`, `REGRESSION-LOG.md`, `state.md`.
- **Risks/Questions:** Eng-director noted frontend has no automated tests — still true; P2 bugs BUG-008/009 remain for frontend. Password reset remains stub-only for R1.
- **Next owner:** qa (re-verify BUG-006/007 and Phase 1 gate), then frontend for P2 UX gaps.

---

## PM Decision (mid-Phase 1) — pm (Product Manager)

- **Status:** Product decision requested by state.md — "Decide if stub password reset is acceptable for Phase 1 closure."
- **Decision:**
  - **Stub password reset is acceptable for Phase 1 closure.** Phase 1's core value is working auth (register, login, logout, token invalidation) + baby profile CRUD. Password reset with real email delivery is a hardening concern, not a Phase 1 gate.
  - Password reset must be fully implemented before Phase 6 (Polish & Ship). It is not acceptable to ship to real users without it.
  - Update R1 acceptance criteria: for Phase 1, "Password reset" means the endpoint exists and returns a token (logged server-side). For Phase 6, it means a real email is sent and the user can complete the flow end-to-end.
  - Quick-log buttons being non-functional is expected — they wire up in Phase 2 (R3, R4, R5). Not a Phase 1 bug.
- **Action:**
  - Recorded this decision in TALK.md.
  - No changes to REQUIREMENTS.md or ROADMAP.md — the phasing already handles this correctly.
- **Risks/Questions:**
  - If we onboard real testers before Phase 6, anyone who forgets their password is stuck. Mitigation: manual reset via database, or fast-track real email in Phase 4–5 timeframe.
  - Frontend still has zero automated tests. This is a growing risk — every phase adds more UI surface area with no regression safety net. Eng Director should enforce a minimum test bar for Phase 2.
- **Next owner:** Frontend continues current turn. QA re-verifies BUG-006/007 next. Phase 1 gate should pass once QA confirms P1 fixes and P2 frontend fixes (BUG-008/009) are in.

---
## Turn 10 — qa (QA Engineer)

- **Status:** Re-verification complete. BUG-006/007 and BUG-008/009 are fixed; one new P1 blocker found for Phase 1 acceptance.
- **Decision:** Keep Phase 1 blocked until baby edit/delete UI is implemented and verified.
- **Action:** Ran `npm test` (`18` backend tests pass), added QA regression test for `PUT /babies/:id` with non-string `date_of_birth`, re-verified backend restart migration safety and strict update validation via manual API probes, re-checked frontend forgot-password and quick-log feedback paths, and updated QA docs/state artifacts.
- **Risks/Questions:** R2 still fails at UI level (`BUG-010`) because users cannot edit/delete existing baby profiles. Password reset remains backend/frontend stub-only for production, though PM accepted this for Phase 1 milestone.
- **Next owner:** backend or frontend (implement edit/delete baby UI path), then QA for final Phase 1 re-test.

---

## Turn 11 — eng-director (Engineering Director)

- **Status:** Engineering review complete; backend fixes from Turns 8-10 hold up, but Phase 1 remains blocked by missing frontend baby profile management.
- **Decision:**
  - `BUG-010` is a real P1 and should block Phase 1 sign-off.
  - The next owner should be `frontend`, not `backend`, because the API already supports update/delete and the missing acceptance is entirely in the UI layer.
  - The cleanest next step is a dedicated baby management flow under an explicit route or settings surface rather than stretching the add-only form.
- **Action:**
  - Reviewed current frontend routes and confirmed `frontend/src/App.tsx` still exposes no edit/delete route.
  - Reviewed `frontend/src/components/Layout.tsx` and confirmed the selector is navigation-only, with no management affordance.
  - Reviewed `frontend/src/context/BabyContext.tsx` and noted it currently only supports fetch/select, which is acceptable for now but will become a maintainability issue if edit/delete logic is scattered across screens.
  - Updated `state.md` with the engineering verdict, architecture direction, and next-step order.
- **Risks/Questions:**
  - Frontend still has no automated regression coverage; once edit/delete lands, QA is still doing too much work manually.
  - Password reset remains acceptable for Phase 1 per PM, but it is still a production ship blocker for later phases.
- **Next owner:** frontend

---

## Turn 12 — pm (Product Manager)

- **Status:** PM check-in. Phase 1 is one frontend turn away from closing. No new product decisions needed.
- **Decision:**
  - BUG-010 (missing edit/delete baby UI) is the sole Phase 1 blocker. Confirmed: backend APIs already support both operations — this is purely a frontend gap.
  - Stub password reset remains acceptable for Phase 1 closure (decided earlier this session). Must be real before Phase 6.
  - Quick-log buttons being non-functional is expected — they activate in Phase 2 (R3, R4, R5).
  - Frontend should also add at least one smoke test before Phase 1 can be called healthy (eng-director's recommendation, PM agrees).
- **Action:**
  - Reviewed state.md, lock.json, and TALK.md turns 8–11.
  - Confirmed no scope changes or reprioritization needed.
  - Releasing lock to frontend.
- **Risks/Questions:**
  - Frontend has zero automated tests after 11 turns. This is the #1 quality risk going into Phase 2. Eng Director and QA should enforce a minimum test bar.
  - Phase 1 has taken more turns than the original 6-turn estimate. Velocity is slower than planned — will reassess after Phase 2 whether Phases 4 (collaboration) or 5 (offline) need to be deferred.
- **Next owner:** frontend (implement edit/delete baby UI + at least one smoke test, then QA re-verifies Phase 1 gate).

---
## Turn 13 — frontend (Frontend Engineer)

- **Status:** Fixed BUG-010 (missing edit/delete baby UI) and added initial frontend tests.
- **Decision:** Created a dedicated `EditBaby` page for updating and deleting a baby profile. Added an "Edit" link to the selected baby card on the Dashboard, and an "Add another baby" link to the baby switcher in the Layout. Set up Vitest + React Testing Library for frontend testing.
- **Action:** 
  - Created `frontend/src/pages/EditBaby.tsx` and wired it to `PUT /babies/:id` and `DELETE /babies/:id`.
  - Updated `App.tsx` with the `/edit-baby/:id` route.
  - Updated `Dashboard.tsx` and `Layout.tsx` to provide access to these flows.
  - Installed `vitest`, `jsdom`, `@testing-library/react`, and `@testing-library/jest-dom`.
  - Configured `vite.config.ts` for testing and added `setupTests.ts`.
  - Wrote `App.test.tsx` with basic smoke tests for unauthenticated routing.
  - Updated `state.md`.
- **Risks/Questions:** The frontend test coverage is very basic (just a smoke test for the router). We should expand this in Phase 2 as the UI grows.
- **Next owner:** qa (to re-verify R2 edit/delete functionality and perform final Phase 1 sign-off).

---
## Turn 15 — qa (QA Engineer)

- **Status:** QA re-verification run completed. Test suites pass and prior Phase 1 P1 blocker (`BUG-010`) is now closed.
- **Decision:** Mark bug backlog clear at P1/P2 feature-completeness level for Phase 1, while keeping known product/UX risks explicitly documented.
- **Action:** Ran `npm test` (backend `19/19`, frontend `3/3`), added QA-owned auth edge-case regression for login email trimming, executed manual unhappy-path API probes (missing fields, wrong types, duplicate submit, invalidated sessions, SQLi/XSS payloads, backend-down simulation), and refreshed all QA artifacts (`BUGS`, `UX-AUDIT`, `TEST-COVERAGE`, `ACCEPTANCE-MATRIX`, `REGRESSION-LOG`, `phase-1/TESTS`, `state`, `history`).
- **Risks/Questions:** Password reset remains stub-only (accepted by PM for Phase 1, but still a ship-to-users risk). Frontend UX debt remains around placeholder Timeline/Settings and keyboard/error-state polish.
- **Next owner:** eng-director / pm (phase-gate decision) or frontend (address UX debt + expand test coverage) before Phase 2.

---

## Turn 16 — eng-director (Engineering Director)

- **Status:** Engineering phase-gate review found a new Phase 1 blocker. Phase 1 is not approved yet.
- **Decision:**
  - Reopen the gate on `BUG-011`: mobile users cannot reach the add-baby flow after the first baby exists, which violates the multi-child/mobile-first bar.
  - Do not advance to Phase 2 yet.
  - Keep the next owner as `frontend`, because this is a UI reachability issue, not a backend/API gap.
- **Action:**
  - Reviewed the latest frontend baby-management implementation and QA artifacts.
  - Confirmed `frontend/src/components/Layout.tsx` only exposes `+ Add another baby` in the desktop sidebar.
  - Confirmed `frontend/src/pages/Dashboard.tsx` now supports `Edit`, but still has no create-another-baby affordance for mobile users with an existing profile.
  - Reopened the blocker in `.planning/qa/BUGS.md`, reverted `R2` in `.planning/qa/ACCEPTANCE-MATRIX.md` to `FAIL`, and updated `state.md` / `state.json`.
- **Risks/Questions:**
  - `frontend/src/App.test.tsx` is still too shallow to protect the new baby-management flow; UI regression coverage remains weak.
  - Password reset remains acceptable for the Phase 1 milestone only, but still blocks real-user production readiness later.
- **Next owner:** frontend

---
## Turn 17 — frontend (Frontend Engineer)

- **Status:** Fixed BUG-011 (mobile users couldn't add another baby).
- **Decision:** Added a `+` icon button next to the baby selector in the mobile header, and an "+ Add another baby" text link on the Dashboard baby card. Both link to `/add-baby`. This ensures mobile and desktop parity for the multi-child creation flow.
- **Action:**
  - Updated `Layout.tsx` to import `Plus` from lucide-react and render a small round `+` button next to the mobile baby selector dropdown.
  - Updated `Dashboard.tsx` to add an "+ Add another baby" link below the baby name/age on the baby profile card.
  - Ran `npm test`: 19 backend + 3 frontend tests pass.
  - Updated `state.md`.
- **Risks/Questions:** The eng-director noted my tests are still too shallow (only auth routing). I agree — we should add baby-management route tests in Phase 2. For now the mobile add-baby path is manually verifiable.
- **Next owner:** qa (to re-verify BUG-011 on mobile and perform final Phase 1 gate sign-off).

---
## Turn 18 — qa (QA Engineer)

- **Status:** QA regression run complete. BUG-011 is verified fixed and Phase 1 blocker list is clear.
- **Decision:** Keep Phase 1 marked technically unblocked while explicitly calling out remaining non-blocking UX/product debt.
- **Action:** Ran `npm test` (`19/19` backend, `3/3` frontend), rechecked API unhappy paths/security probes, verified mobile add-another-baby reachability through new UI affordances, and refreshed QA artifacts (`BUGS`, `ACCEPTANCE-MATRIX`, `TEST-COVERAGE`, `REGRESSION-LOG`, `phase-1/TESTS`, `state`, `history`).
- **Risks/Questions:** Password reset remains stub-only (allowed for Phase 1 milestone by PM, not sufficient for real-user shipment). Timeline/settings placeholders and accessibility polish remain UX debt entering Phase 2.
- **Next owner:** eng-director / pm for formal phase-gate call, then frontend/backend for Phase 2 implementation.

---
