# Acceptance Matrix — agentXchain.dev

**Run:** run_da40a332eed44f56
**Turn:** turn_c168cebde30fb319 (QA)
**Scope:** M4 Checkpoint-Restore Crash Resume — PID liveness guard in `step --resume`, stale dispatch-progress cleanup, regression coverage

## Section A: SYSTEM_SPEC Acceptance Tests

| Req # | Requirement (from SYSTEM_SPEC.md §Acceptance Tests) | Evidence | Status |
|-------|------------------------------------------------------|----------|--------|
| AC-001 | `step --resume` with dead `worker_pid` on active running turn proceeds to re-dispatch (crash recovery verified) | `step-crash-resume.test.js` "re-dispatches an active running turn with a dead worker pid and removes stale dispatch-progress" — sets PID 99999999 (dead), writes dispatch-progress, calls `stepCommand({resume:true})`, asserts `dispatchLocalCli` called once, turn transitions to `dispatched`, `worker_pid` cleared. QA verified source at `step.js:1045-1058` — `guardResumeWorkerLiveness()` detects dead PID via `isWorkerAlive()`, calls `cleanupStaleDispatchProgress()`, then returns to allow re-dispatch. | PASS |
| AC-002 | `step --resume` with alive `worker_pid` on active running turn rejects with clear error (duplicate dispatch prevented) | `step-crash-resume.test.js` "rejects active running turn resume when the previous worker pid is still alive" — sets PID to `process.pid` (guaranteed alive), calls `stepCommand({resume:true})`, captures exit. Asserts: exit code 1, output matches `/Worker process \(PID \d+\) is still alive/`, `dispatchLocalCli` not called, turn remains `running`, dispatch-progress file preserved. QA verified `step.js:1050-1054` — alive PID branch prints error and calls `process.exit(1)`. | PASS |
| AC-003 | `step --resume` with no `worker_pid` on active running turn proceeds normally (backwards compatible) | `step-crash-resume.test.js` "keeps no-pid active running turn resume backwards compatible" — sets up running turn with `worker_pid: null` (via `setRunningTurn(root, turnId, null)`), calls resume. Asserts: `dispatchLocalCli` called once, turn accepted and removed from `active_turns`. QA verified `step.js:1046-1047` — `worker_pid == null` guard returns early, no liveness check. | PASS |
| AC-004 | Stale `dispatch-progress-{turnId}.json` is deleted during crash recovery before re-dispatch | `step-crash-resume.test.js` test 1: writes `dispatch-progress-{turnId}.json` before resume, asserts `existsSync(progressPath) === false` after resume. Also test 4 (blocked path): same pattern. QA verified `step.js:1075-1086` — `cleanupStaleDispatchProgress()` calls `unlinkSync()` in try/catch, guarded by `existsSync()`. | PASS |
| AC-005 | `npm run test` passes with no regressions | Full suite: 665 test files, 7386 tests, 0 failures. Independently run by QA to completion (duration 2069s). | PASS |

## Section B: Code Correctness Verification

| Check | Detail | Status |
|-------|--------|--------|
| PID guard placement — active path | `guardResumeWorkerLiveness(root, targetTurn)` called at step.js:196, after target turn resolution, before `skipAssignment = true`. Correct per SYSTEM_SPEC §2.1. | PASS |
| PID guard placement — blocked path | `guardResumeWorkerLiveness(root, targetTurn)` called at step.js:277, **before** `reactivateGovernedRun()` at line 279. Deviation from SYSTEM_SPEC §2.1 which says "after reactivation." Dev's ordering is **superior**: if worker is alive, run stays blocked (no state mutation). DEC-001 documents this reasoning. | PASS |
| `isWorkerAlive()` defensive validation | step.js:1062-1063 validates PID is a positive integer before `process.kill(pid, 0)`. Prevents `NaN`, negative, or string PIDs from throwing unexpected errors. Not in spec but defensively correct. | PASS |
| `cleanupStaleDispatchProgress()` error handling | step.js:1081-1084 wraps `unlinkSync` in try/catch. Best-effort cleanup prevents filesystem race conditions from aborting the resume path. | PASS |
| `guardResumeWorkerLiveness()` is a single reusable function | Both active (line 196) and blocked (line 277) paths call the same function. Eliminates risk of logic drift between the two paths. | PASS |
| No new exports | All helpers (`guardResumeWorkerLiveness`, `isWorkerAlive`, `cleanupStaleDispatchProgress`) are module-private in step.js. Per SYSTEM_SPEC §Interface: "No New Exports." | PASS |
| Vitest contract file count updated | `vitest-contract.test.js:56` asserts `TEST_FILES.length === 665`, accounting for the new `step-crash-resume.test.js`. | PASS |
| ROADMAP.md item checked off | ROADMAP.md:62 — M4 "Improve checkpoint-restore" marked `[x]` with `run_da40a332eed44f56` evidence. | PASS |

## Section C: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| step-crash-resume.test.js | 4 | PASS |
| vitest-contract.test.js | 11 | PASS |
| agent-talk-word-cap.test.js | 8 | PASS |
| **Full suite total (665 files)** | **7386** | **0 failures** |

## Section D: Dev Challenge

**Blocked-path guard ordering (DEC-001):** Dev placed `guardResumeWorkerLiveness()` **before** `reactivateGovernedRun()` at step.js:277, contradicting SYSTEM_SPEC §2.1 which says "after reactivation, before baseline refresh." QA independently reviewed both orderings and confirms dev's choice is correct: rejecting a resume when the worker is alive should not mutate the run from `blocked` to `active` as a side effect. The IMPLEMENTATION_NOTES.md documents this reasoning explicitly. **Accepted.**

**Test implementation pattern (DEC-002):** Dev tests the PID guard by mocking `dispatchLocalCli` and calling `stepCommand({resume:true})` directly, rather than exporting the private `guardResumeWorkerLiveness`. This follows the established test pattern for step.js and avoids coupling tests to internal helper structure. QA verified all 4 test cases exercise the guard through the real resume flow. **Accepted.**

**Vitest contract update (DEC-003):** File count moved from 664 to 665, reflecting the new `step-crash-resume.test.js`. QA verified the count matches the actual filesystem: 665 `.test.js` files under `cli/test/`. **Accepted.**
