# Regression Log — Baby Tracker

Bugs that were found and fixed. Each entry has a regression test to prevent recurrence.

| Bug ID | Description | Found turn | Fixed turn | Regression test | Status |
|--------|-------------|-----------|-----------|----------------|--------|
| BUG-001 | Missing auth endpoints (`/auth/register`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`) | 2 | — | Pending: add endpoint existence + contract tests per route | Open |
| BUG-002 | Missing `/babies` CRUD route set and auth enforcement | 2 | — | Pending: add baby CRUD integration tests + 401/403 coverage | Open |
| BUG-004 | Dashboard lacks selected-baby and empty-state behavior | 2 | — | Pending: frontend component tests for empty state and selected baby header | Open |
