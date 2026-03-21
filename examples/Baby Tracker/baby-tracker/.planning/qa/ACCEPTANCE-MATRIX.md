# Acceptance Matrix — Baby Tracker

Maps every requirement to its test status. This is the definitive "can we ship?" document.

| Req # | Requirement | Acceptance criteria | Functional test | UX test | Last tested | Status |
|-------|-------------|-------------------|-----------------|---------|-------------|--------|
| R1 | User Authentication | Register, login, logout, sessions, password reset | `npm test` auth suite passes; manual checks confirm register/login/logout/invalid-session behavior; forgot-password endpoint exists but is stub-only | Login/register/forgot-password screens work with validation feedback | 2026-03-21 | FAIL (password reset not end-to-end) |
| R2 | Baby Profile Management | CRUD babies, switch baby, dashboard default | `npm test` babies suite passes (including wrong-type rejection); manual API checks confirm create/list/update/delete auth and validation | Edit/delete routes are present and mobile add-another-baby reachability is restored via header/dashboard affordances | 2026-03-21 | PASS |
| R3 | Feeding Tracking | Log/edit/delete feeding, timeline | Not yet implemented | Quick-log buttons only (no flow) | 2026-03-21 | FAIL |
| R4 | Diaper Tracking | Log/edit/delete diaper, visual distinction | Not yet implemented | Static card only, no CRUD | 2026-03-21 | FAIL |
| R5 | Sleep Tracking | Timer/manual, duration, active sleep UI | Not yet implemented | Static card only, no timer | 2026-03-21 | FAIL |
| R6 | Notes & Activities | Notes with categories, timeline | Not yet implemented | No notes UI | 2026-03-21 | FAIL |
| R7 | Growth Tracking | Measurements, units, history list | Not yet implemented | Growth quick action has no behavior | 2026-03-21 | FAIL |
| R8 | Timeline View | Unified chronological timeline | Not yet implemented | Timeline route is placeholder text | 2026-03-21 | FAIL |
| R9 | Multi-Caregiver Collaboration | Invite, shared data, revoke | Not yet implemented | No collaboration UI | 2026-03-21 | FAIL |
| R10 | Offline-First Operation | Local storage, sync, indicator | Not yet implemented | No offline indicator in shell | 2026-03-21 | FAIL |
| R11 | Responsive Mobile-First UI | 375/768/1440, touch targets | Layout verified in runtime and manual viewport checks; touch targets meet 44px baseline | Mobile + tablet + desktop layout works; minor accessibility/error UX gaps tracked separately | 2026-03-21 | PASS |
