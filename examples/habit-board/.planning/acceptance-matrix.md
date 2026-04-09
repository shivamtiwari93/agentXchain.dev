# Acceptance Matrix

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| HABIT-001 | Server starts and serves frontend at `/` | `test/api.test.js` | PASS |
| HABIT-002 | Create, list, and delete habits via API | `test/api.test.js` | PASS |
| HABIT-003 | Check and uncheck today for a habit | `test/api.test.js` | PASS |
| HABIT-004 | Streak calculation correct for consecutive days | `test/store.test.js` | PASS |
| HABIT-005 | Streak handles gaps correctly | `test/store.test.js` | PASS |
| HABIT-006 | Duplicate check for same date is idempotent | `test/store.test.js` | PASS |
| HABIT-007 | Invalid input returns 400/404 with error JSON | `test/api.test.js` | PASS |
| HABIT-008 | `agentxchain template validate --json` passes | contract test | PASS |
