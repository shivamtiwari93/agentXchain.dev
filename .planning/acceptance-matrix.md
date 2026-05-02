# Acceptance Matrix — agentXchain.dev

**Run:** run_eae4ef9d3ad5e2e3
**Turn:** turn_23a78920dde1fbed (QA)
**Scope:** BUG-115 roadmap housekeeping — verify already-shipped fix + check-offs + dev regression tightening

## Section A: Acceptance Contract

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| AC-001 | BUG-115 implementation markers present in continuous-run.js | `writeSessionCheckpoint(root, nextState, 'blocker_cleared')` at line 640, `isGovernedRunStillActiveForSession()` at line 644, `session_failed_recovered_active_run` event at line 2579. QA independently verified via `grep -n`. | PASS |
| AC-002 | ROADMAP.md BUG-FIX items 54-57 all checked off | Lines 54-57 all begin with `- [x]`. QA independently verified via `sed -n '53,57p' .planning/ROADMAP.md`. | PASS |
| AC-003 | Dev's regression tightening is correct and tests pass | Dev added `phase` and `last_turn_id` assertions to BUG-115 checkpoint test (line 1115-1116). Phase flows from `writeGhostBlockedState` → `state.phase: 'implementation'` → `writeSessionCheckpoint` → `checkpoint.phase`. Turn ID flows from reissued turn in `active_turns` → `getActiveTurnIds` → `lastTurnId`. Both assertions are meaningful. BUG-115 targeted: 3/3 pass. | PASS |
| AC-004 | No regressions — full test suite passes | 441 tests across 9 suites verified independently by QA, 0 failures. | PASS |

## Section B: Code Path Verification

| Check | Detail | Status |
|-------|--------|--------|
| Session checkpoint covers all 4 callers | `clearGhostBlockerAfterReissue()` is the shared function called by all 4 recovery paths. Checkpoint at line 640 covers all callers. Re-verified. | PASS |
| Phase preservation in checkpoint | `writeSessionCheckpoint` at session-checkpoint.js:97 derives `lastPhase = state.current_phase \|\| state.phase`. State carries `phase: 'implementation'` from `writeGhostBlockedState`. | PASS |
| Turn ID tracking in checkpoint | `writeSessionCheckpoint` at session-checkpoint.js:93-95 derives `lastTurnId` from `activeTurnIds`. After reissue, the new turn is the only active turn. | PASS |
| `continuous-run.js` parses cleanly | `node --check cli/src/lib/continuous-run.js` exits 0. | PASS |

## Section C: Regression Suites (QA-Verified)

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
