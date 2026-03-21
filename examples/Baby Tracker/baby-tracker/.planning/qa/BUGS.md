# Bugs — Baby Tracker

## Open

### BUG-001
- **Title:** Auth API endpoints are missing (`/auth/register`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`)
- **Severity:** P1
- **Steps to reproduce:**
  1. Start API: `npm run dev --workspace backend`
  2. Run `curl -i -X POST http://127.0.0.1:3000/auth/register -H "Content-Type: application/json" -d '{}'`
  3. Run `curl -i -X POST http://127.0.0.1:3000/auth/login -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"wrong"}'`
- **Expected behavior:** Routes exist and return validation/auth responses (201/400/401), not route-missing.
- **Actual behavior:** Both calls return `404 Cannot POST /auth/...`.
- **File and line number:** `backend/src/app.ts` (only `/health` route currently implemented)

### BUG-002
- **Title:** Baby profile CRUD API is missing (`/babies`)
- **Severity:** P1
- **Steps to reproduce:**
  1. Start API: `npm run dev --workspace backend`
  2. Run `curl -i http://127.0.0.1:3000/babies`
- **Expected behavior:** Protected route exists and returns `401` without token.
- **Actual behavior:** `404 Cannot GET /babies`.
- **File and line number:** `backend/src/app.ts`

### BUG-003
- **Title:** Frontend auth and baby profile flows are not implemented
- **Severity:** P1
- **Steps to reproduce:**
  1. Open frontend app (`npm run dev --workspace frontend`)
  2. Inspect main screen and navigation.
- **Expected behavior:** Sign up/login screens, forgot-password flow, add/edit baby forms, and baby switcher are available in Phase 1.
- **Actual behavior:** App shows static tabs (`Home`, `History`, `Settings`) with no auth or baby profile forms.
- **File and line number:** `frontend/src/App.tsx`

### BUG-004
- **Title:** Dashboard does not show selected baby info and required empty state
- **Severity:** P1
- **Steps to reproduce:**
  1. Open frontend app.
  2. View dashboard/home content.
- **Expected behavior:** Shows selected baby name, calculated age, and empty-state message when no events exist.
- **Actual behavior:** Hardcoded sample activity cards are shown; no selected baby or age.
- **File and line number:** `frontend/src/App.tsx`

### BUG-005
- **Title:** App shell responsive behavior does not match Phase 1 spec (no desktop sidebar)
- **Severity:** P2
- **Steps to reproduce:**
  1. Open frontend app at desktop width (1440px).
  2. Inspect navigation layout.
- **Expected behavior:** Bottom nav on mobile and sidebar navigation on desktop/tablet per Phase 1 plan.
- **Actual behavior:** Fixed bottom nav is used for all breakpoints; no sidebar path exists.
- **File and line number:** `frontend/src/App.tsx`

## Fixed

(Bugs move here when dev confirms the fix and QA verifies it.)
