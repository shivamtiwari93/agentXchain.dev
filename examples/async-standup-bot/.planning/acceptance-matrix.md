# Acceptance Matrix

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| STANDUP-001 | Browser UI served at `/` | `test/api.test.js` | PASS |
| STANDUP-002 | Teams and members can be created | `test/api.test.js`, `test/store.test.js` | PASS |
| STANDUP-003 | Checkins upsert by member/date | `test/store.test.js`, `test/api.test.js` | PASS |
| STANDUP-004 | Summary reports submitted, missing, blockers | `test/store.test.js`, `test/smoke.js` | PASS |
| STANDUP-005 | Reminder preview only targets missing members | `test/store.test.js`, `test/api.test.js` | PASS |
| STANDUP-006 | Retention prune removes old standups | `test/store.test.js`, `test/api.test.js` | PASS |
| STANDUP-007 | Invalid inputs return truthful errors | `test/api.test.js` | PASS |
| STANDUP-008 | Workflow-kit validates cleanly | `agentxchain template validate --json` | PASS |
