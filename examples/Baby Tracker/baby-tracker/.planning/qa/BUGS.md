# Bugs — Baby Tracker

## Open

### BUG-010
- **Title:** Baby profile edit/delete UI is missing in Phase 1
- **Severity:** P1
- **Steps to reproduce:**
  1. Register/login and create a baby profile from `/add-baby`.
  2. Navigate across dashboard/settings/timeline.
  3. Attempt to find any control to edit or delete an existing baby profile.
- **Expected behavior:** User can edit and delete baby profiles from UI per R2 acceptance.
- **Actual behavior:** No route or action exists for edit/delete in frontend navigation/pages.
- **File and line number:** `frontend/src/App.tsx` (only `Dashboard`, `AddBaby`, `Timeline`, `Settings` routes)

## Fixed

### BUG-001 (QA verified fixed on Turn 6)
- **Was:** Auth routes returned 404.
- **Now:** `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/forgot-password` implemented; regression: `backend/tests/auth.test.ts`.

### BUG-002 (QA verified fixed on Turn 6)
- **Was:** `/babies` returned 404.
- **Now:** `GET/POST /babies`, `PUT/DELETE /babies/:id` with JWT auth and creator-only delete; regression: `backend/tests/babies.test.ts`.

### BUG-003 (QA verified fixed on Turn 6)
- **Was:** Frontend auth and baby profile flows were missing.
- **Now:** `Login`, `Register`, `AddBaby`, protected routes, and baby switcher implemented in `frontend/src`.

### BUG-004 (QA verified fixed on Turn 6)
- **Was:** Dashboard lacked selected baby and empty-state behavior.
- **Now:** Dashboard shows selected baby avatar/name/age and empty state sections in `frontend/src/pages/Dashboard.tsx`.

### BUG-005 (QA verified fixed on Turn 6)
- **Was:** No desktop sidebar layout.
- **Now:** Desktop/tablet sidebar implemented in `frontend/src/components/Layout.tsx`.

### BUG-006 (QA verified fixed on Turn 10)
- **Verification evidence:** Restarted backend against persisted DB and confirmed clean startup (`Baby Tracker API listening on http://127.0.0.1:3000`) without duplicate-column crash.

### BUG-007 (QA verified fixed on Turn 10)
- **Verification evidence:** `PUT /babies/:id` with `{"name":123}` returns `400 {"error":"name must be a string"}` and with `{"gender":false}` returns `400 {"error":"gender must be a string"}`.

### BUG-008 (QA verified fixed on Turn 10)
- **Was:** forgot-password was dead `href="#"`.
- **Now:** login links to `ForgotPassword` page and submit triggers `/auth/forgot-password` flow in `frontend/src/pages/ForgotPassword.tsx`.

### BUG-009 (QA verified fixed on Turn 10)
- **Was:** quick-log cards had no action.
- **Now:** dashboard quick-log buttons provide explicit "coming soon in Phase 2" feedback on click.
