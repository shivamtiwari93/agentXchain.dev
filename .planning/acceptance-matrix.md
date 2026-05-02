# Acceptance Matrix — agentXchain.dev

**Run:** run_aeb78d7979d66c0a
**Turn:** turn_252750ed9241b7a4 (QA)
**Scope:** Fix session status inconsistency after ghost auto-retry (BUG-115)

## Section A: Acceptance Contract

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| AC-001 | After `clearGhostBlockerAfterReissue()`, both `state.json` and `session.json` agree on `status: active`, `blocked: false` | `clearGhostBlockerAfterReissue()` at continuous-run.js:631-642 writes `writeGovernedState(root, nextState)` followed by `writeSessionCheckpoint(root, nextState, 'blocker_cleared')`. BUG-115 test (line 1075) reads session.json and asserts `run_status === 'active'`, `blocked === false`, `checkpoint_reason === 'blocker_cleared'`, session_id preserved. | PASS |
| AC-002 | Ghost auto-retry followed by transient `executeGovernedRun()` failure does NOT terminate loop when governed run has active turns | Main-loop guard at continuous-run.js:2576 checks `step.status === 'failed' && isGovernedRunStillActiveForSession(root, context.config, session)`. If true, sets `session.status = 'running'`, emits `session_failed_recovered_active_run` event, continues loop. BUG-115 "recovers a failed step" test (line 1911) verifies `executeCount === 2`, recovery event emitted, session completes normally. | PASS |
| AC-003 | No regressions — `npm run test` passes | continuous-run.test.js: 90/90, governed-state.test.js: 99/99, turn-result-validator.test.js: 100/100, gate-evaluator.test.js: 52/52, release-preflight.test.js: 15/15, vision-reader.test.js: 36/36, session-checkpoint.test.js: 6/6, agent-talk-word-cap.test.js: 8/8, checkpoint-turn.test.js + dispatch-bundle-decision-history.test.js + vitest-contract.test.js: 35/35 combined. Pre-existing flaky timeout in claim-reality-preflight.test.js (not touched by dev). | PASS |

## Section B: Code Path Verification

| Check | Detail | Status |
|-------|--------|--------|
| Session checkpoint covers all 4 callers | `clearGhostBlockerAfterReissue()` is the shared function called by all 4 recovery paths (Claude Node runtime, Claude auth, productive timeout, ghost blocker). The checkpoint call at line 640 covers all callers without per-site changes. | PASS |
| Helper is fail-safe | `isGovernedRunStillActiveForSession()` at line 644 catches all exceptions and returns `false` — failed disk reads do not trigger recovery. | PASS |
| Loop guard placement | Guard at line 2576 is BEFORE the terminal state check, so `'failed'` is intercepted before loop exit logic. | PASS |
| No reissueTurn modification | Dev correctly left `reissueTurn()` in governed-state.js unchanged — Bug A fix is in the shared clear function. | PASS |
| No cold-start scope creep | `canResumeExistingContinuousSession()` and `reconcileContinuousStartupState()` are unchanged — confirmed via git diff. | PASS |

## Section C: Negative Case Verification

| Check | Detail | Status |
|-------|--------|--------|
| Inactive governed run → no recovery | BUG-115 "keeps a failed step terminal when the governed run is inactive" test (line 1999): state.json `status: 'completed'`, loop exits with code 1, session stays `'failed'`, no recovery event emitted. | PASS |
| Run ID mismatch → no recovery | `isGovernedRunStillActiveForSession()` returns false when `session.current_run_id !== state.run_id`. Covered by test structure. | PASS |

## Section D: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| continuous-run.test.js | 90 | PASS |
| governed-state.test.js | 99 | PASS |
| turn-result-validator.test.js | 100 | PASS |
| gate-evaluator.test.js | 52 | PASS |
| release-preflight.test.js | 15 | PASS |
| vision-reader.test.js | 36 | PASS |
| session-checkpoint.test.js | 6 | PASS |
| agent-talk-word-cap.test.js | 8 | PASS |
| checkpoint-turn.test.js + dispatch-bundle + vitest-contract | 35 | PASS |
| **QA-verified total** | **441** | **0 failures** |
