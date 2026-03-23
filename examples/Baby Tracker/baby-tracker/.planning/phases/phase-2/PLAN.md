# Phase 2 — Core Tracking + Timeline

## Goal

Parents can log the three core events that make this app valuable day to day: feedings, diapers, and sleep. Those events appear in a unified timeline in correct chronological order and can be edited or deleted safely.

## Requirements Covered

- **R3** — Feeding Tracking
- **R4** — Diaper Tracking
- **R5** — Sleep Tracking
- **R8** — Timeline View

## Engineering Direction

- Use a single, stable timeline response shape for the frontend, even if the backend stores event types separately.
- Validation stays strict: reject invalid enums, wrong types, impossible timestamps, and negative durations.
- Do not ship timeline logic that requires the frontend to merge multiple endpoint shapes on its own.

## Deliverables

### Backend Engineer

1. **Tracking data model**
   - Add persistent schema for feedings, diapers, and sleep entries.
   - Ensure every entry is scoped to a baby and created by an authenticated user.
   - Support edit/delete without orphaned or inconsistent records.

2. **Tracking APIs**
   - Feeding create/list/update/delete endpoints with validation for type, amount or duration, and timestamp.
   - Diaper create/list/update/delete endpoints with validation for diaper type, notes, and timestamp.
   - Sleep start/stop and manual create/update/delete endpoints with duration calculation and active-sleep handling.

3. **Timeline API**
   - Add a unified timeline endpoint for a selected baby and date range.
   - Return entries in descending chronological order with a discriminated `type` and normalized display fields.
   - Include enough data for the frontend to render timeline cards without extra joins or per-type follow-up calls.

4. **Tests**
   - Endpoint coverage for happy path and validation failures on all new routes.
   - Tests for timeline ordering, edit/delete behavior, access control, and active sleep state rules.

### Frontend Engineer

1. **Quick log flows**
   - Replace Phase 1 quick-log placeholders with actual feeding, diaper, and sleep flows.
   - Support one-handed mobile entry with obvious defaults and minimal typing.
   - Show loading, success, and error states for every submission path.

2. **Timeline screen**
   - Replace placeholder timeline route with the real unified timeline.
   - Show event icon, core details, relative time, and empty-state copy.
   - Support navigation across days without confusing resets of selected baby.

3. **Sleep UX**
   - Show active sleep state clearly on the dashboard.
   - Support start/stop flow and manual sleep entry without making the user re-enter redundant data.

4. **Tests**
   - Add at least smoke-level coverage for timeline rendering and one core tracking form.
   - Extend tests beyond auth routing so baby/tracking regressions are detectable automatically.

### Engineering Director

1. Review API design for timeline consistency and validation quality.
2. Verify that active sleep state is modeled safely and cannot produce overlapping or impossible states.
3. Block the phase if the timeline contract is inconsistent across event types or if frontend error states are weak.

### QA Engineer

1. Test feedings, diapers, sleep, and timeline against the acceptance criteria.
2. Add at least one regression test the engineers did not write for each core event family.
3. Probe boundary cases: future timestamps, invalid enums, duplicate stop-sleep requests, overlapping sleep sessions, and out-of-order edits.
4. Re-run responsive and UX checks on the real timeline at 375px, 768px, and 1440px.

## Acceptance Criteria (Phase Gate)

Phase 2 is DONE when all of the following are true:

- [ ] User can create, edit, and delete a feeding entry
- [ ] User can create, edit, and delete a diaper entry
- [ ] User can start and stop a sleep timer and also log sleep manually
- [ ] Active sleep is visible on the dashboard and resolves correctly when stopped
- [ ] Timeline shows all supported event types in correct chronological order
- [ ] Timeline defaults to today and supports viewing past days
- [ ] Timeline entries show key details and relative time
- [ ] All new tracking routes reject invalid input with clear `400` errors
- [ ] Access control prevents one user from changing another caregiver household's data
- [ ] Frontend quick-log actions are real flows, not placeholders
- [ ] Backend and frontend tests pass
- [ ] No P0 or P1 bugs open

## Estimated Agent Turns

- Backend: 2 turns (schema + endpoints, timeline + active sleep rules)
- Frontend: 2 turns (quick-log forms, timeline + dashboard updates)
- Eng Director: 1 turn (API/UX review)
- QA: 1 turn (full phase gate)
- **Total: ~6 agent turns for Phase 2**
