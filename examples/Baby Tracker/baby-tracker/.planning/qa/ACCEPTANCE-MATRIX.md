# Acceptance Matrix — Baby Tracker

Maps every requirement to its test status. This is the definitive "can we ship?" document.

| Req # | Requirement | Acceptance criteria | Functional test | UX test | Last tested | Status |
|-------|-------------|-------------------|-----------------|---------|-------------|--------|
| R1 | User Authentication | Register, login, logout, sessions, password reset | `npm test` auth suite passes; curl confirms register/login/logout/missing fields; forgot-password API returns stub `ok:true` | Login/register screens work; forgot-password link is dead (`BUG-008`) | 2026-03-21 | FAIL |
| R2 | Baby Profile Management | CRUD babies, switch baby, dashboard default | curl confirms create/list/update/delete auth paths; wrong-type payload is accepted (`BUG-007`) | Add-baby + switcher + dashboard default work; edit/delete baby UI missing | 2026-03-21 | FAIL |
| R3 | Feeding Tracking | Log/edit/delete feeding, timeline | Not yet implemented | Quick-log buttons only (no flow) | 2026-03-21 | FAIL |
| R4 | Diaper Tracking | Log/edit/delete diaper, visual distinction | Not yet implemented | Static card only, no CRUD | 2026-03-21 | FAIL |
| R5 | Sleep Tracking | Timer/manual, duration, active sleep UI | Not yet implemented | Static card only, no timer | 2026-03-21 | FAIL |
| R6 | Notes & Activities | Notes with categories, timeline | Not yet implemented | No notes UI | 2026-03-21 | FAIL |
| R7 | Growth Tracking | Measurements, units, history list | Not yet implemented | Growth quick action has no behavior | 2026-03-21 | FAIL |
| R8 | Timeline View | Unified chronological timeline | Not yet implemented | Timeline route is placeholder text | 2026-03-21 | FAIL |
| R9 | Multi-Caregiver Collaboration | Invite, shared data, revoke | Not yet implemented | No collaboration UI | 2026-03-21 | FAIL |
| R10 | Offline-First Operation | Local storage, sync, indicator | Not yet implemented | No offline indicator in shell | 2026-03-21 | FAIL |
| R11 | Responsive Mobile-First UI | 375/768/1440, touch targets | Layout verified at code/runtime level; touch targets meet 44px baseline | Mobile + tablet + desktop layout works; dead-end nav remains (`UX-002`) | 2026-03-21 | PASS |
