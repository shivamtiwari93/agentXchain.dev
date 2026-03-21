# Acceptance Matrix — Baby Tracker

Maps every requirement to its test status. This is the definitive "can we ship?" document.

| Req # | Requirement | Acceptance criteria | Functional test | UX test | Last tested | Status |
|-------|-------------|-------------------|-----------------|---------|-------------|--------|
| R1 | User Authentication | Register, login, logout, sessions, password reset | Backend: Vitest auth suite + routes exist; password reset is stub only | Auth pages missing in UI | 2026-03-21 | PARTIAL (API pass, UI fail) |
| R2 | Baby Profile Management | CRUD babies, switch baby, dashboard default | Backend: Vitest babies suite | Baby form/switcher missing in UI | 2026-03-21 | PARTIAL (API pass, UI fail) |
| R3 | Feeding Tracking | Log/edit/delete feeding, timeline | Not yet implemented | Quick-log buttons only (no flow) | 2026-03-21 | FAIL |
| R4 | Diaper Tracking | Log/edit/delete diaper, visual distinction | Not yet implemented | Static card only, no CRUD | 2026-03-21 | FAIL |
| R5 | Sleep Tracking | Timer/manual, duration, active sleep UI | Not yet implemented | Static card only, no timer | 2026-03-21 | FAIL |
| R6 | Notes & Activities | Notes with categories, timeline | Not yet implemented | No notes UI | 2026-03-21 | FAIL |
| R7 | Growth Tracking | Measurements, units, history list | Not yet implemented | Growth quick action has no behavior | 2026-03-21 | FAIL |
| R8 | Timeline View | Unified chronological timeline | Not yet implemented | History tab is placeholder text | 2026-03-21 | FAIL |
| R9 | Multi-Caregiver Collaboration | Invite, shared data, revoke | Not yet implemented | No collaboration UI | 2026-03-21 | FAIL |
| R10 | Offline-First Operation | Local storage, sync, indicator | Not yet implemented | No offline indicator in shell | 2026-03-21 | FAIL |
| R11 | Responsive Mobile-First UI | 375/768/1440, touch targets | Frontend builds; no viewport automation yet | No desktop sidebar, responsive criteria incomplete | 2026-03-21 | FAIL |
