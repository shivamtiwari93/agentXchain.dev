# Roadmap — Baby Tracker

## Waves

| Wave | Theme | Phases | Goal |
|------|-------|--------|------|
| 1 | Foundation + Core Tracking | 1, 2 | Users can sign up, add babies, and log the three core events (feed, diaper, sleep) with a working timeline. |
| 2 | Extended Tracking + Collaboration | 3, 4 | Notes, growth tracking, and multi-caregiver sharing make the app complete for a household. |
| 3 | Offline + Ship | 5, 6 | Offline-first reliability, polish, and production readiness. App is shippable. |

## Phases

| Phase | Name | Description | Requirements | Status |
|-------|------|-------------|-------------|--------|
| 1 | **Project Setup & Auth** | Scaffold the project, set up the database, implement user auth, baby profile CRUD, and the responsive app shell with navigation. | R1, R2, R11 (foundation) | Complete |
| 2 | **Core Tracking + Timeline** | Implement feeding, diaper, and sleep logging. Build the unified timeline view. This is where the app becomes usable. | R3, R4, R5, R8 | In progress |
| 3 | **Notes & Growth** | Add notes/activity logging with category tags and growth measurement tracking (weight, height, head circumference). | R6, R7 | Planned |
| 4 | **Multi-Caregiver Collaboration** | Invite flow, shared baby access, near real-time data visibility across users. Permission management. | R9 | Planned |
| 5 | **Offline-First** | Service worker, local IndexedDB storage, background sync on reconnect, conflict resolution, online/offline status indicator. | R10 | Planned |
| 6 | **Polish & Ship** | Bug fixes, performance optimization, responsive refinements, accessibility pass, final QA sign-off. Production deployment. | R11 (final pass), all regression | Planned |

## Phase Dependencies

```
Phase 1 (Setup & Auth)
  └── Phase 2 (Core Tracking + Timeline)
        ├── Phase 3 (Notes & Growth)
        │     └── Phase 4 (Collaboration)
        │           └── Phase 5 (Offline-First)
        │                 └── Phase 6 (Polish & Ship)
        └── (Phase 3 and 4 can partially overlap)
```

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-21 | Web-first, mobile-native later | Ship faster; validate with real users before investing in native. |
| 2026-03-21 | Offline-first is Phase 5, not Phase 1 | Core tracking logic must exist before offline layer wraps it. Building offline from day 1 would slow all other phases. |
| 2026-03-21 | All 11 requirements in MVP | User validated that collaboration, offline, and growth tracking are all must-haves, not nice-to-haves. |
| 2026-03-21 | Phase 1 accepted as a milestone; Phase 2 activated | Phase 1 blockers are closed and the app now supports auth, baby CRUD, and responsive shell behavior needed to begin real tracking flows. |
