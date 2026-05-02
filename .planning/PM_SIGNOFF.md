# PM Signoff — Fix Session Status Inconsistency After Ghost Auto-Retry

Approved: YES

**Run:** `run_aeb78d7979d66c0a`
**Phase:** planning
**Turn:** `turn_090b3ad5a98819d2`
**Date:** 2026-05-02

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running continuous mode (`agentxchain run --continuous`). After ghost auto-retry, session state files diverge: `session.json` reports `run_status: 'blocked'` while `state.json` correctly shows `status: 'active'`. Additionally, the continuous loop can mark the session terminally `'failed'` on a transient `executeGovernedRun()` failure even when the governed run has active turns.

### Core Pain Point

Two related bugs in the ghost auto-retry recovery path:

**Bug A — Session checkpoint gap (observed NOW in this run's own state):**

`clearGhostBlockerAfterReissue()` at `continuous-run.js:630-639` writes `status: 'active'` to `state.json` but does NOT write a corresponding session checkpoint. The last session checkpoint was written by `reissueTurn()` at `governed-state.js:4032`, which spreads the pre-clear state that still has `status: 'blocked'`.

Current evidence (this run):
- `session.json`: `run_status: 'blocked'`, `blocked: true`, `checkpoint_reason: 'turn_reissued'`
- `state.json`: `status: 'active'`, active turn `turn_090b3ad5a98819d2` with `status: 'running'`

**Bug B — Continuous session premature terminal:**

After ghost auto-retry succeeds (session `'running'`, governed state `'active'`), if the next `executeGovernedRun()` call fails (throws or non-zero exit), the continuous loop unconditionally sets `session.status = 'failed'` without checking whether the governed run is still active. The main loop treats `'failed'` as terminal and exits, leaving an orphaned active run.

### Root Cause Analysis

**Bug A — `clearGhostBlockerAfterReissue()` missing session checkpoint:**

The function is called from 4 recovery paths:

| # | Caller | Line | Recovery Type |
|---|--------|------|---------------|
| 1 | `reclassifyRetainedClaudeNodeIncompatGhost()` | 441 | Claude Node runtime recovery |
| 2 | `maybeAutoRetryRetainedClaudeAuthDispatch()` | 543 | Claude auth refresh recovery |
| 3 | `maybeAutoRetryProductiveTimeoutBlocker()` | 777 | Productive timeout retry |
| 4 | `maybeAutoRetryGhostBlocker()` | 925 | Ghost turn auto-retry |

All 4 paths: `reissueTurn()` writes session checkpoint with stale blocked state → `clearGhostBlockerAfterReissue()` clears block in state.json but never writes session checkpoint → session.json remains stale.

**Bug B — Premature terminal failure:**

Sequence: ghost retry → governed active, session running → next `executeGovernedRun()` fails → `session.status = 'failed'` (lines 2198, 2229, 2370, 2443) → loop exits at line 2564 → active governed run orphaned.

### Core Workflow

1. PM (this turn) — root cause analysis, scoped dev charter
2. Dev — implement 3 code changes + 3 regression tests
3. QA — verify session checkpoint consistency and loop recovery

### MVP Scope (this run)

**Dev:** Three code changes + three regression tests:

#### Code Change 1: Session checkpoint in `clearGhostBlockerAfterReissue()` [Bug A fix]

**File:** `cli/src/lib/continuous-run.js`

Add `writeSessionCheckpoint` import from `./session-checkpoint.js` and call it inside `clearGhostBlockerAfterReissue()`:

```javascript
// Top of file — add to imports:
import { writeSessionCheckpoint } from './session-checkpoint.js';

// In clearGhostBlockerAfterReissue() — add after writeGovernedState:
function clearGhostBlockerAfterReissue(root, state) {
  const nextState = {
    ...state,
    status: 'active',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
  };
  writeGovernedState(root, nextState);
  writeSessionCheckpoint(root, nextState, 'blocker_cleared');  // NEW
  return nextState;
}
```

This is a 2-line change (1 import, 1 function call) that fixes all 4 affected paths.

#### Code Change 2: `isGovernedRunStillActiveForSession()` helper [Bug B prerequisite]

**File:** `cli/src/lib/continuous-run.js`, after `clearGhostBlockerAfterReissue()` (~line 640)

```javascript
function isGovernedRunStillActiveForSession(root, config, session) {
  try {
    const state = loadProjectState(root, config);
    if (!state || state.status !== 'active') return false;
    if (session.current_run_id && state.run_id
        && session.current_run_id !== state.run_id) return false;
    return true;
  } catch {
    return false;
  }
}
```

Pure read. Returns `true` only when governed state is `'active'` and `run_id` matches. Returns `false` on error (fail-safe).

#### Code Change 3: Main loop recovery guard [Bug B fix]

**File:** `cli/src/lib/continuous-run.js`, in `executeContinuousRun()` main loop, BEFORE the terminal state check at line 2564

```javascript
if (step.status === 'failed'
    && isGovernedRunStillActiveForSession(root, context.config, session)) {
  session.status = 'running';
  writeContinuousSession(root, session);
  emitRunEvent(root, 'session_failed_recovered_active_run', {
    run_id: session.current_run_id || null,
    phase: null,
    status: 'active',
    payload: {
      session_id: session.session_id,
      failed_action: step.action || null,
      failed_reason: step.stop_reason || null,
    },
  });
  log('Session failure recovered — governed run still active, continuing.');
  continue;
}
```

#### Regression Tests (3 tests)

**Test 1: Session checkpoint updated after blocker clear [Bug A]**
- Setup: temp dir with state.json `status: 'blocked'` and session.json with `run_status: 'blocked'`
- Action: call `clearGhostBlockerAfterReissue(root, blockedState)`
- Assert: session.json has `run_status: 'active'`, `blocked: false`, `checkpoint_reason: 'blocker_cleared'`
- Assert: session_id preserved

**Test 2: Main loop recovery — failed step with active governed run [Bug B]**
- Setup: mock `advanceContinuousRunOnce` to return `{ status: 'failed' }` first, then `{ status: 'completed' }`
- Setup: state.json with `status: 'active'`, matching run_id
- Assert: loop does NOT exit on first step; session recovered to `'running'`; `session_failed_recovered_active_run` event emitted

**Test 3: Main loop no-recovery — failed step with inactive governed run [Bug B negative]**
- Setup: mock `advanceContinuousRunOnce` to return `{ status: 'failed' }`
- Setup: state.json with `status: 'completed'`
- Assert: loop exits immediately; session stays `'failed'`; no recovery event

### Out of Scope

- **Cold-start resume of `'failed'` sessions** — The previous PM turn (turn_d1836f66c561daa1) proposed adding `'failed'` to the `canResumeExistingContinuousSession()` whitelist and startup reconciliation. This changes existing cold-start behavior and needs more careful analysis. The main loop guard (Change 3) prevents the premature failure in normal operation. Cold-start recovery is defense-in-depth for a narrow edge case (process crash between failure write and loop guard) and can be a follow-up.
- **Modifying individual `session.status = 'failed'` sites** — The main loop guard handles all of them.
- **Refactoring `clearGhostBlockerAfterReissue` naming** — Cosmetic, not a bug fix.
- **Structured recovery classification** — That's M4 scope.

### Success Metric

1. After calling `clearGhostBlockerAfterReissue()`, `session.json` has `run_status: 'active'` and `blocked: false`
2. Ghost auto-retry followed by `executeGovernedRun()` failure does NOT terminate loop when governed run is active
3. All existing tests pass (`npm run test`)

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `writeSessionCheckpoint()` throws in `clearGhostBlockerAfterReissue` | None | `writeSessionCheckpoint` is non-fatal (catches errors, logs warning). Same safety model as all other checkpoint call sites. |
| Recovery guard creates infinite loop | Medium | Governed run eventually times out, exhausts retries, or blocks → state leaves `'active'`, breaking the recovery loop. |
| Double session checkpoint (reissueTurn writes one, blocker_cleared writes another) | None | Session.json is overwritten, not appended. Second write with correct state is desired. |
| Import cycle risk | None | `session-checkpoint.js` has no imports from `continuous-run.js`. |

## Challenge to Previous Work

### OBJ-PM-001: Previous PM missed the session.json checkpoint gap (severity: medium)

The previous PM turn (turn_d1836f66c561daa1) diagnosed the continuous-session.json premature terminal issue but did NOT identify the session.json checkpoint gap in `clearGhostBlockerAfterReissue()`. This gap is actively manifesting in the current run state right now: `session.json:run_status='blocked'` vs `state.json:status='active'`. The previous approach would fix Bug B (loop recovery) but leave Bug A unresolved — `session.json` would remain stale after every ghost auto-retry.

### OBJ-PM-002: Cold-start resume changes are overscoped (severity: low)

The previous PM proposed adding `'failed'` to the session resume whitelist (`canResumeExistingContinuousSession`) and startup reconciliation in `reconcileContinuousStartupState()`. This is defense-in-depth for a narrow edge case (process crash between failure write and loop guard). It also changes cold-start behavior — some legitimate `'failed'` sessions would now be resumed instead of discarded. This needs more careful analysis and is better suited as a follow-up once the primary fixes land.

## Notes for Dev

**Your charter is: 1 import + 1 checkpoint call in `clearGhostBlockerAfterReissue()` + 1 helper function + 1 loop guard + 3 regression tests.**

Key implementation details:

1. **Import location:** Add `writeSessionCheckpoint` to imports at top of `continuous-run.js`. It's exported from `./session-checkpoint.js`. Confirm no circular dependency (there isn't one).

2. **Checkpoint reason:** Use `'blocker_cleared'` as the reason. This distinguishes it from the `'turn_reissued'` checkpoint written moments earlier by `reissueTurn()`.

3. **Loop guard placement:** Insert BEFORE the terminal state check at line 2564, not after. The guard must intercept `'failed'` steps before they trigger loop exit.

4. **Do NOT change `reissueTurn()`.** Its checkpoint at `governed-state.js:4032` is correct for its scope. The bug is that `clearGhostBlockerAfterReissue()` (which runs after) doesn't write the updated state.

5. **Do NOT change `canResumeExistingContinuousSession()` or `reconcileContinuousStartupState()`.** Those are out of scope for this run.

## Notes for QA

- **Primary verification for Bug A:** Read `session.json` after `clearGhostBlockerAfterReissue()` — must have `run_status: 'active'`, `blocked: false`
- **Primary verification for Bug B:** Verify the loop recovery test — `'failed'` step with active governed run → session recovered, loop continues
- **Negative case:** `'failed'` step with inactive governed run → loop exits (existing behavior preserved)
- **Regression risk:** Zero for Bug A (non-fatal checkpoint write). Low for Bug B (new code path, but fail-safe default)
- **All 4 checkpoint paths:** The Bug A fix is in the shared function, covering all 4 callers automatically

## Acceptance Contract

1. **Session.json checkpoint consistency** — After `clearGhostBlockerAfterReissue()`, both `state.json` and `session.json` agree on `status: 'active'` / `run_status: 'active'`, `blocked: false`.
2. **Loop resilience** — Ghost auto-retry followed by transient `executeGovernedRun()` failure does NOT terminate the continuous loop when the governed run has active turns.
3. **No regressions** — `npm run test` passes.
