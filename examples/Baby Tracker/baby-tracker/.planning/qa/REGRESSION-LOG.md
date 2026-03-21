# Regression Log — Baby Tracker

Bugs that were found and fixed. Each entry has a regression test to prevent recurrence.

| Bug ID | Description | Found turn | Fixed turn | Regression test | Status |
|--------|-------------|-----------|-----------|----------------|--------|
| BUG-001 | Missing auth endpoints | 3 | 4 | `backend/tests/auth.test.ts` + QA curl route probes | Fixed (QA verified turn 6) |
| BUG-002 | Missing `/babies` CRUD + auth | 3 | 4 | `backend/tests/babies.test.ts` + QA curl probes | Fixed (QA verified turn 6) |
| BUG-003 | Missing frontend auth/baby flows | 3 | 5 | Manual UI verification (`Login`, `Register`, `AddBaby`, switcher) | Fixed (QA verified turn 6) |
| BUG-004 | Missing selected-baby/empty-state dashboard behavior | 3 | 5 | Manual UI verification of dashboard states | Fixed (QA verified turn 6) |
| BUG-005 | Missing desktop sidebar responsive layout | 3 | 5 | Manual 768/1440 layout verification | Fixed (QA verified turn 6) |
| BUG-006 | Backend restart crash from migration idempotency | 6 | 8 | `backend/tests/migrations.test.ts` | Fixed (pending QA verify) |
| BUG-007 | Baby update accepts wrong type payload (`name: 123`) | 6 | 8 | `backend/tests/babies.test.ts` | Fixed (pending QA verify) |
