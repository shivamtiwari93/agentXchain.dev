# System Spec — Fix Session Status Inconsistency After Ghost Auto-Retry

**Run:** `run_aeb78d7979d66c0a`
**Baseline:** git:da0db2b3bb1e295c205bd7ca9ce94e5183d2af14
**Package version:** `agentxchain@2.155.72`

## Purpose

Fix two related session status inconsistencies that occur after ghost auto-retry recovery:

**Bug A:** `clearGhostBlockerAfterReissue()` writes `status: 'active'` to `state.json` but does not write a corresponding session checkpoint, leaving `session.json` stale with `run_status: 'blocked'`.

**Bug B:** The continuous run loop unconditionally marks `session.status = 'failed'` on `executeGovernedRun()` failure without checking whether the governed run is still active, causing premature loop exit.

**Scope:** 3 code changes in `cli/src/lib/continuous-run.js` + 3 regression tests. No new files. No protocol changes. No config changes.

## Interface

### State Files (Before Fix — Bug A)

After ghost auto-retry, the three state files are inconsistent:

| File | Field | Value | Correct? |
|------|-------|-------|----------|
| `.agentxchain/state.json` | `status` | `'active'` | YES |
| `.agentxchain/session.json` | `run_status` | `'blocked'` | NO (stale) |
| `.agentxchain/session.json` | `blocked` | `true` | NO (stale) |
| `.agentxchain/session.json` | `checkpoint_reason` | `'turn_reissued'` | stale |
| `.agentxchain/continuous-session.json` | `status` | `'running'` | YES |

### State Files (After Fix — Bug A)

| File | Field | Value | Correct? |
|------|-------|-------|----------|
| `.agentxchain/state.json` | `status` | `'active'` | YES |
| `.agentxchain/session.json` | `run_status` | `'active'` | YES |
| `.agentxchain/session.json` | `blocked` | `false` | YES |
| `.agentxchain/session.json` | `checkpoint_reason` | `'blocker_cleared'` | YES |
| `.agentxchain/continuous-session.json` | `status` | `'running'` | YES |

### Continuous Session Status (Before Fix — Bug B)

```
ghost retry → session 'running' → executeGovernedRun fails
    → session 'failed' (TERMINAL) → loop exits → orphaned active run
```

### Continuous Session Status (After Fix — Bug B)

```
ghost retry → session 'running' → executeGovernedRun fails
    → session 'failed' → governed state 'active'?
        YES → session 'running' (recovered), loop continues
        NO  → session 'failed' (TERMINAL), loop exits
```

## Files Modified

| File | Change |
|------|--------|
| `cli/src/lib/continuous-run.js` | 3 code changes: import + checkpoint call + helper + loop guard |

## Change 1: Session checkpoint in `clearGhostBlockerAfterReissue()` [Bug A]

**Location:** `cli/src/lib/continuous-run.js`

**Import (top of file):**
```javascript
import { writeSessionCheckpoint } from './session-checkpoint.js';
```

**Function change (line 630-639):**

Before:
```javascript
function clearGhostBlockerAfterReissue(root, state) {
  const nextState = {
    ...state,
    status: 'active',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
  };
  writeGovernedState(root, nextState);
  return nextState;
}
```

After:
```javascript
function clearGhostBlockerAfterReissue(root, state) {
  const nextState = {
    ...state,
    status: 'active',
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
  };
  writeGovernedState(root, nextState);
  writeSessionCheckpoint(root, nextState, 'blocker_cleared');
  return nextState;
}
```

**Contract:**
- Non-fatal: `writeSessionCheckpoint()` catches errors internally (try/catch in session-checkpoint.js:83-156)
- Idempotent: session.json is always overwritten, not appended
- Session_id preserved: `writeSessionCheckpoint()` reads existing session.json and preserves `session_id` when `run_id` matches
- No import cycle: `session-checkpoint.js` → `(fs, path, crypto, child_process)` — no dependency on `continuous-run.js`

**Covers all 4 callers:**

| # | Caller | Line |
|---|--------|------|
| 1 | `reclassifyRetainedClaudeNodeIncompatGhost()` | 441 |
| 2 | `maybeAutoRetryRetainedClaudeAuthDispatch()` | 543 |
| 3 | `maybeAutoRetryProductiveTimeoutBlocker()` | 777 |
| 4 | `maybeAutoRetryGhostBlocker()` | 925 |

## Change 2: `isGovernedRunStillActiveForSession()` helper [Bug B prerequisite]

**Location:** After `clearGhostBlockerAfterReissue()` (~line 640)

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

**Contract:**
- Pure read — no side effects, no state writes
- Returns `true` only when governed state is `'active'` AND `run_id` matches (or either is absent)
- Returns `false` on any error (fail-safe: don't prevent legitimate failures from being terminal)

## Change 3: Main loop recovery guard [Bug B fix]

**Location:** `executeContinuousRun()` main loop, BEFORE the terminal state check at line 2564

```javascript
// Recovery: if step failed but governed run is still active, recover session
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

**Contract:**
- Fires only when `step.status === 'failed'` AND governed state is `'active'` with matching run_id
- Emits `session_failed_recovered_active_run` audit event
- Uses `continue` to skip terminal check and proceed to next loop iteration
- Does NOT fire for genuine failures where governed state is terminal

## Behavior

### Bug A — Checkpoint Flow (After Fix)

1. Ghost detected → `raiseBlockedState()` writes state.json (`status: 'blocked'`) + session.json (`run_status: 'blocked'`)
2. `reissueTurn()` creates new turn → writes state.json (still blocked) + session.json (`run_status: 'blocked'`, `checkpoint_reason: 'turn_reissued'`)
3. `clearGhostBlockerAfterReissue()` → writes state.json (`status: 'active'`) + **session.json** (`run_status: 'active'`, `checkpoint_reason: 'blocker_cleared'`) ← **NEW**
4. Caller updates continuous-session.json (`status: 'running'`)
5. All three state files are consistent.

### Bug B — Loop Recovery (After Fix)

1. Ghost auto-retry → governed `'active'`, session `'running'`
2. `advanceContinuousRunOnce()` → `executeGovernedRun()` fails → returns `{ status: 'failed' }`
3. **Recovery guard fires** → `isGovernedRunStillActiveForSession()` returns `true`
4. Session recovered to `'running'`, event emitted, `continue`
5. Next iteration picks up active governed run

### Genuine Failure (no active run)

1. `executeGovernedRun()` fails → `{ status: 'failed' }`
2. `isGovernedRunStillActiveForSession()` returns `false` (state is completed/blocked/absent)
3. Guard does NOT fire → terminal check exits loop (existing behavior unchanged)

## Error Cases

| Failure Mode | Response |
|-------------|----------|
| `writeSessionCheckpoint()` throws in `clearGhostBlockerAfterReissue` | Caught internally, warning logged. Recovery continues unaffected. |
| `loadProjectState` throws during recovery check | `isGovernedRunStillActiveForSession()` catches, returns `false` → session stays `'failed'`, loop exits (fail-safe) |
| Governed state has different `run_id` | Helper returns `false` → no recovery |
| Recovery loop: governed run keeps failing | Run eventually times out / exhausts retries → state leaves `'active'` → guard stops firing |
| Process crash between failure write and loop guard | Session persists as `'failed'`. Next restart discards the session and starts fresh. (Cold-start recovery for this edge case is out of scope — tracked as follow-up.) |

## Acceptance Tests

- [ ] After `clearGhostBlockerAfterReissue()`, session.json has `run_status: 'active'` and `blocked: false` [Bug A]
- [ ] After `clearGhostBlockerAfterReissue()`, session.json has `checkpoint_reason: 'blocker_cleared'` [Bug A]
- [ ] After `clearGhostBlockerAfterReissue()`, session_id is preserved [Bug A]
- [ ] Main loop recovery: `step.status === 'failed'` + governed `status: 'active'` → session recovered, loop continues [Bug B]
- [ ] Main loop no-recovery: `step.status === 'failed'` + governed `status: 'completed'` → loop exits [Bug B negative]
- [ ] `npm run test` passes with no regressions
