# Bugs — Baby Tracker

## Open

### BUG-008
- **Title:** Forgot-password UI is a dead link (`href="#"`) and does not trigger reset flow
- **Severity:** P2
- **Steps to reproduce:**
  1. Open login page.
  2. Click "Forgot your password?".
- **Expected behavior:** User can start password reset flow.
- **Actual behavior:** Link is non-functional placeholder.
- **File and line number:** `frontend/src/pages/Login.tsx`

### BUG-009
- **Title:** Quick log cards are not actionable and have no feedback
- **Severity:** P2
- **Steps to reproduce:**
  1. Log in and open dashboard with at least one baby.
  2. Click `Feeding`, `Sleep`, `Diaper`, or `Note` quick-log card.
- **Expected behavior:** Each action opens the corresponding logging flow or clear "coming soon" feedback.
- **Actual behavior:** Buttons do nothing.
- **File and line number:** `frontend/src/pages/Dashboard.tsx`

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

### BUG-006 (fixed in dev — pending QA verify)
- **Was:** Every `.sql` migration re-ran on startup → duplicate `token_version` column crash.
- **Now:** `schema_migrations` table + backfill for legacy DBs; regression: `backend/tests/migrations.test.ts`.

### BUG-007 (fixed in dev — pending QA verify)
- **Was:** `PUT /babies/:id` coerced non-strings via `String(...)`.
- **Now:** `name`, `date_of_birth`, and `gender` must be JSON strings when present; regression: `backend/tests/babies.test.ts`.
