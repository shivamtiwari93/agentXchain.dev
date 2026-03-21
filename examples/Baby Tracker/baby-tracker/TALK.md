# Baby Tracker — Team Talk File

Canonical human-readable handoff log for all agents.

## How to write entries

Use this exact structure:

## Turn N — <agent_id> (<role>)
- Status:
- Decision:
- Action:
- Risks/Questions:
- Next owner:

---

## Turn 0 — pm (Product Manager)

- **Status:** PM kickoff complete. Scope finalized with human.
- **Decision:**
  - Target user: Parents, grandparents, nannies, caregivers of newborns and young children (including multiples).
  - MVP includes 11 requirements across 6 phases in 3 waves: (1) Foundation + Core Tracking, (2) Extended Tracking + Collaboration, (3) Offline + Ship.
  - Web-first, mobile-first responsive. Native mobile app is v2.
  - Offline-first is required but phased to Phase 5 so core tracking logic is built first.
  - Success metric: parents log events multiple times per day, every day of the week.
  - No tech stack mandated — engineering team decides.
- **Action:**
  - Wrote PROJECT.md (vision, constraints, stack direction).
  - Wrote REQUIREMENTS.md (11 requirements with acceptance criteria, phased).
  - Wrote ROADMAP.md (3 waves, 6 phases, dependency graph, decision log).
  - Wrote Phase 1 PLAN.md (deliverables per agent role, acceptance criteria, turn estimates).
  - Wrote Phase 1 TESTS.md (22 functional tests, 5 security tests, 5 edge cases).
  - Updated state.md with current architecture decisions and next steps.
- **Risks/Questions:**
  - Scope is ambitious for an MVP (11 requirements including offline-first and multi-caregiver). May need to re-evaluate if velocity is slow.
  - Conflict resolution strategy for offline sync is not yet designed — Phase 5 concern.
  - Photo upload for baby profiles intentionally deferred.
- **Next owner:** Human reviews and approves kickoff. Then Backend Engineer starts Phase 1.

---

## Turn 1 — backend (Backend Engineer)

- **Status:** Phase 1 backend scaffold complete; tests green.
- **Decision:** Use Express + TypeScript + SQLite via `better-sqlite3` with versioned `.sql` migrations applied in filename order — minimal ops footprint and matches PM’s Node/npm test bar.
- **Action:** Added root npm workspace, `backend` server (`src/index.ts`, `createApp`), `openDatabase` + `001_init.sql`, `GET /health`, Vitest integration test; initialized QA coverage/acceptance/UX docs with real rows; moved roadmap Phase 1 to In progress.
- **Risks/Questions:** Phase 1 PLAN says `POST /auth/logout` “invalidates session” — need a concrete JWT strategy (stateless vs denylist). `lock.json` had `holder: human` / `last_released_by: null`; round-robin should use `last_released_by: eng-director` before backend claims per playbook.
- **Next owner:** frontend (app shell) or eng-director (standards review), per rotation after lock release.

---
