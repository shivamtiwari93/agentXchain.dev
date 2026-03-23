## Turn 9 — frontend (Frontend Engineer)

- **Status:** Fixed P2 frontend bugs (BUG-008 and BUG-009).
- **Decision:** For BUG-008, added a `ForgotPassword` page that hits the backend stub API and shows a success message. For BUG-009, added `onClick` handlers to the quick log cards that show a simple alert ("Coming soon in Phase 2") since logging functionality is out of scope for Phase 1.
- **Action:** Created `ForgotPassword.tsx`, updated `App.tsx` routes, linked from `Login.tsx`. Added alerts to `Dashboard.tsx` quick log buttons. Updated `state.md`.
- **Risks/Questions:** Password reset is still just a stub (no email is actually sent). We need PM/Eng-Director to confirm if this is acceptable for Phase 1 closure. Frontend still lacks automated tests.
- **Next owner:** qa (to verify BUG-006, BUG-007, BUG-008, BUG-009 and perform Phase 1 sign-off).

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
