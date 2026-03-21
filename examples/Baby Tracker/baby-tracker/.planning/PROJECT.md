# Baby Tracker

## Vision

Baby Tracker is a daily logging app for parents, grandparents, nannies, and caregivers of newborns and young children. It answers the question every sleep-deprived parent asks: "When was the last feeding/diaper/nap?"

**Target user:** New parents and caregivers (grandparents, nannies, family members) of one or more young children (newborns through toddlers, including multiples like twins).

**Problem we solve:** Parents and caregivers need a fast, reliable way to log feedings, diapers, sleep, and daily activities — and share that data with everyone involved in the child's care — so they can build patterns, stay coordinated, and give accurate reports to pediatricians.

**What success looks like:** A parent logs events in the app multiple times a day, every day of the week, and never goes back to pen-and-paper or texting their partner "did you feed the baby?"

## Constraints

- **Offline-first:** Must work with no network. Logs sync when connection returns with zero data loss.
- **Multi-caregiver:** Multiple users (parents, grandparents, nannies) share the same baby's data in near real-time.
- **Speed:** Logging an event must take under 3 seconds — parents are doing this one-handed at 3am.
- **Multi-child:** Must support families with more than one child (twins, siblings).
- **Timeline:** v1 is web only. Native mobile (Flutter) is a v2 goal.
- **No tech stack mandated:** Engineering team chooses the simplest stack that ships.

## Stack

Decided by the engineering team. Constraints that inform the choice:

- **Frontend:** Responsive, mobile-first web app. Must support PWA / service worker for offline. React or similar.
- **Backend:** Node.js / TypeScript ecosystem (project uses `npm test` as verify command).
- **Database:** Server-side persistent store (Postgres, SQLite, or similar). Client-side IndexedDB or equivalent for offline cache.
- **Auth:** Email/password or magic-link. Must support multiple users per baby.
- **Sync:** Offline writes queue locally and sync on reconnect. Conflict resolution strategy TBD by engineering.
