# Bugs — Baby Tracker

## Open

### BUG-006
- **Title:** Backend dev server crashes on restart due non-idempotent migration
- **Severity:** P1
- **Steps to reproduce:**
  1. Run `npm run dev --workspace backend` with existing SQLite file at `./data/baby-tracker.db`.
  2. Observe startup logs.
- **Expected behavior:** Server starts repeatedly without migration errors.
- **Actual behavior:** Process crashes with `SqliteError: duplicate column name: token_version`.
- **File and line number:** `backend/src/db.ts`, `backend/src/migrations/002_token_version.sql`

### BUG-007
- **Title:** Baby update endpoint accepts wrong type for `name` instead of rejecting invalid payload
- **Severity:** P1
- **Steps to reproduce:**
  1. Register/login and create a baby.
  2. Run `curl -i -X PUT http://127.0.0.1:3000/babies/<id> -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"name":123}'`.
- **Expected behavior:** `400` validation error for wrong type.
- **Actual behavior:** `200 OK`; name is coerced to string `"123"` and saved.
- **File and line number:** `backend/src/routes/babies.ts`

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
