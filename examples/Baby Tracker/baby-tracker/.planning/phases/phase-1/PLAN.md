# Phase 1 — Project Setup & Auth

## Goal

A user can sign up, log in, create a baby profile, and see an empty dashboard with navigation. The app shell is responsive and mobile-first. This is the skeleton everything else plugs into.

## Requirements Covered

- **R1** — User Authentication
- **R2** — Baby Profile Management
- **R11** — Responsive Mobile-First UI (foundation layer)

## Deliverables

### Backend Engineer

1. **Project scaffold**
   - Initialize Node.js/TypeScript project with package.json, tsconfig, linter
   - Choose and set up database (Postgres or SQLite)
   - Create database schema for: users, babies, baby_caregivers (join table)
   - Set up migration system
   - Health endpoint: `GET /health` returns `{ status: "ok" }`

2. **Auth API**
   - `POST /auth/register` — email, password, name. Returns JWT.
   - `POST /auth/login` — email, password. Returns JWT.
   - `POST /auth/logout` — invalidates session.
   - `POST /auth/forgot-password` — sends reset email (stub for v1, just log the token).
   - Auth middleware that protects all other routes.

3. **Baby Profile API**
   - `POST /babies` — create a baby profile (name, date_of_birth, gender).
   - `GET /babies` — list all babies the current user has access to.
   - `PUT /babies/:id` — update a baby profile.
   - `DELETE /babies/:id` — delete a baby profile (only if user is the creator).
   - Baby is automatically linked to the creating user as primary caregiver.

4. **Tests**
   - At least one test per endpoint.
   - Auth tests: register, login, protected route without token returns 401.
   - Baby CRUD tests: create, list, update, delete, access control.

### Frontend Engineer

1. **App shell**
   - Responsive layout: bottom nav on mobile, sidebar on desktop.
   - Navigation: Dashboard, Timeline (placeholder), Add (+) button, Settings.
   - Mobile-first CSS: works at 375px, 768px, 1440px.

2. **Auth screens**
   - Sign Up screen: name, email, password, confirm password.
   - Log In screen: email, password, "forgot password" link.
   - Form validation with inline error messages.
   - After login, redirect to dashboard.

3. **Baby profile screens**
   - "Add Baby" form: name, date of birth, gender.
   - Baby switcher in the header/nav (for multi-child families).
   - "Edit Baby" accessible from settings or baby profile tap.

4. **Dashboard (empty state)**
   - Shows baby name + age (calculated from DOB).
   - Empty state: "No events logged yet. Tap + to start tracking."
   - Quick-action buttons for: Feed, Diaper, Sleep, Note (wired up in Phase 2).

### Engineering Director

1. Review project scaffold for: folder structure, naming conventions, dependency choices.
2. Verify auth implementation for: password hashing, JWT expiry, input validation.
3. Establish coding standards doc for the team.

### QA Engineer

1. Set up test runner and config.
2. Run all backend tests — report pass/fail.
3. Test auth flow manually: register, login, invalid credentials, expired token.
4. Test baby CRUD: create, edit, delete, switch between babies.
5. Test responsive layout at 375px, 768px, 1440px.
6. Initialize QA tracking docs (BUGS.md, ACCEPTANCE-MATRIX.md, TEST-COVERAGE.md).

## Acceptance Criteria (Phase Gate)

Phase 1 is DONE when all of the following are true:

- [ ] User can register with email/password and receive a session token
- [ ] User can log in with valid credentials; invalid credentials are rejected with a clear error
- [ ] All API routes (except register/login) return 401 without a valid token
- [ ] User can create a baby profile with name, DOB, and gender
- [ ] User can see a list of their babies and switch between them
- [ ] User can edit and delete a baby profile
- [ ] App shell renders correctly at 375px, 768px, and 1440px with no horizontal scroll
- [ ] Bottom navigation is visible and functional on mobile
- [ ] Dashboard shows the selected baby's name and calculated age
- [ ] Empty state is displayed when no events exist
- [ ] All backend tests pass
- [ ] No P0 or P1 bugs open

## Estimated Agent Turns

- Backend: 2 turns (scaffold + auth, baby CRUD)
- Frontend: 2 turns (shell + auth screens, baby profile + dashboard)
- Eng Director: 1 turn (review + standards)
- QA: 1 turn (test everything, file bugs)
- **Total: ~6 agent turns for Phase 1**
