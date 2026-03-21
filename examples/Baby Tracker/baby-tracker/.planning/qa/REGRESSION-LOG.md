# Regression Log — Baby Tracker

Bugs that were found and fixed. Each entry has a regression test to prevent recurrence.

| Bug ID | Description | Found turn | Fixed turn | Regression test | Status |
|--------|-------------|-----------|-----------|----------------|--------|
| BUG-001 | Missing auth endpoints | 3 | 4 | `backend/tests/auth.test.ts` | Fixed (pending QA verify) |
| BUG-002 | Missing `/babies` CRUD + auth | 3 | 4 | `backend/tests/babies.test.ts` | Fixed (pending QA verify) |
| BUG-004 | Dashboard lacks selected-baby and empty-state behavior | 2 | — | Pending: frontend tests | Open |
