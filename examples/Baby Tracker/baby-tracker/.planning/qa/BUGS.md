# Bugs — Baby Tracker

## Open

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

### BUG-001 (fixed in dev — pending QA re-check)
- **Was:** Auth routes returned 404.
- **Now:** `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/forgot-password` implemented; regression: `backend/tests/auth.test.ts`.

### BUG-002 (fixed in dev — pending QA re-check)
- **Was:** `/babies` returned 404.
- **Now:** `GET/POST /babies`, `PUT/DELETE /babies/:id` with JWT auth and creator-only delete; regression: `backend/tests/babies.test.ts`.
