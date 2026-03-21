# Baby Tracker — Current State

## Architecture

- **Status:** Phase 1 backend P1 blockers (BUG-006 / BUG-007) addressed in code; awaiting QA re-verification.
- **Backend:** Node.js + TypeScript + Express + SQLite with **tracked** migrations (`schema_migrations` + backfill for legacy DBs).
- **Frontend:** React + Vite + Tailwind with auth screens, protected layout, baby switcher, add-baby flow, and dashboard empty states.
- **Auth model:** JWT access token plus `token_version` invalidation on logout.
- **Engineering standards:** `.planning/ENGINEERING-STANDARDS.md` is the source of truth for repo structure, validation, migration safety, test expectations, and review bar.

## Engineering Director Turn 7 Assessment (resolved in code)

- **BUG-006:** Migration runner now records applied filenames and skips re-execution; legacy DBs with `users` but no migration table are backfilled so `002_token_version.sql` is not re-run when the column already exists.
- **BUG-007:** `PUT /babies/:id` requires `name`, `date_of_birth`, and `gender` to be JSON **strings** when present (no `String()` coercion).

## Open Issues

- **P2 gaps:** `BUG-008`, `BUG-009` (frontend forgot-password link + quick-log affordances).
- **Product gap:** password reset is still stub-only; `R1` is not truly complete for shipping to real users.
- **Test gap:** frontend has no automated tests yet; Phase 1 still depends mostly on manual UI verification.

## Next Steps

1. QA: re-run `BUG-006`/`BUG-007` regressions, then re-check Phase 1 acceptance and UX docs.
2. Frontend: address `BUG-008` / `BUG-009` per eng-director priorities.
3. Backend (follow-up): consider shared Zod or `zod` schemas for auth/babies if validation grows further.
