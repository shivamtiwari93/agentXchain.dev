# Requirements — Baby Tracker

## v1 (MVP)

| # | Requirement | Acceptance Criteria | Phase | Status |
|---|-------------|-------------------|-------|--------|
| R1 | **User Authentication** | User can register (email/password), log in, log out. Sessions persist across browser restarts. Password reset works. | 1 | Pending |
| R2 | **Baby Profile Management** | User can create, edit, and delete baby profiles (name, date of birth, gender, optional photo). User can switch between multiple babies. Dashboard defaults to most recently viewed baby. | 1 | Pending |
| R3 | **Feeding Tracking** | User can log a feeding with: type (breast-left, breast-right, bottle, solids), amount or duration, and timestamp. Entry appears in timeline within 1 second. User can edit or delete a feeding entry. | 2 | Pending |
| R4 | **Diaper Tracking** | User can log a diaper change with: type (wet, dirty, both), optional notes, and timestamp. Wet vs dirty is visually distinct in the timeline. User can edit or delete an entry. | 2 | Pending |
| R5 | **Sleep Tracking** | User can start/stop a sleep timer OR manually log sleep with start and end time. Sleep duration is auto-calculated and displayed. Active sleep shows a running timer on the dashboard. User can edit or delete an entry. | 2 | Pending |
| R6 | **Notes & Activities** | User can log a free-text note with an optional category tag from a predefined list (bath, clothes change, doctor visit, medicine, tummy time, milestone, other). Notes appear in the timeline with their tag. User can edit or delete a note. | 3 | Pending |
| R7 | **Growth Tracking** | User can log weight, height, and head circumference with date. Units can be toggled between metric (kg/cm) and imperial (lb/in). Growth history is viewable as a list sorted by date. | 3 | Pending |
| R8 | **Timeline View** | All event types (feeding, diaper, sleep, notes, growth) appear in a unified, chronological timeline. Default view is today. User can navigate to past days. Each entry shows type icon, key details, and relative time ("2h ago"). | 2 | Pending |
| R9 | **Multi-Caregiver Collaboration** | A primary user can invite others (via email or shareable link) to access a baby's data. All collaborators see the same data. A new log entry from one user is visible to others within 30 seconds (when online). Inviter can revoke access. | 4 | Pending |
| R10 | **Offline-First Operation** | All logging features (R3–R8) work without internet. Data is stored locally and syncs automatically when connection is restored. No data is lost. User sees a clear indicator of online/offline status. | 5 | Pending |
| R11 | **Responsive Mobile-First UI** | App is fully usable on phones (375px+), tablets (768px+), and desktop (1440px+). Touch targets are 44px minimum. Primary actions are reachable with one thumb. No horizontal scroll on any screen. | 1–6 | Pending |

## v2 (Future)

Captured here so they don't creep into MVP:

- Native mobile app (Flutter / React Native)
- Push notifications and reminders ("It's been 3 hours since last feeding")
- Charts and analytics (feeding patterns, sleep trends, growth percentiles)
- Pediatrician report export (PDF / shareable link)
- Photo attachments on log entries
- Milestone tracking with age-based suggestions
- Medicine / vaccination tracker
- Integration with wearables or smart baby monitors

## Out of scope

Explicitly not building for any version:

- Social features (sharing publicly, comparing with other babies)
- E-commerce / product recommendations
- AI-based health advice or diagnosis
- Video or audio logging
