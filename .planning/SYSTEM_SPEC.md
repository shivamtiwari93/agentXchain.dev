# System Spec — M4: Checkpoint-Restore Verification for Killed Mid-Turn Processes

**Run:** `run_da40a332eed44f56`
**Baseline:** git:536a6591d41cb25760ea40aeffac78b63b893580
**Package version:** `agentxchain@2.155.72`

## Purpose

Verify and improve the checkpoint-restore path so that a killed mid-turn process (e.g., `kill -9` of the `agentxchain step` orchestrator while a worker subprocess is active) can cleanly resume via `step --resume`. Currently the resume path works mechanically (re-dispatches the turn), but lacks PID liveness detection, crash-specific logging, and dispatch-progress cleanup — creating risk of duplicate dispatch (if the old worker is still alive) and stale progress data (if the old worker is dead).

**Why now:** The M4 audit (run_24a851cc6e95d841) identified 17 recovery gaps. Recovery classification (run_5276bd12be02449a) added observability. This item closes the loop by verifying the primary crash-recovery path works end-to-end and hardening it against the two critical gaps: duplicate dispatch and stale state.

---

## 1. Current Behavior Analysis

### 1.1 What Happens Today When a Process Is Killed Mid-Turn

1. Worker subprocess (Claude Code, GPT, etc.) is killed or the `agentxchain step` process itself is killed
2. `state.json` persists with the turn in `active_turns`, status `running`, `worker_pid` set
3. `session.json` shows last checkpoint (e.g., `turn_assigned`)
4. `dispatch-progress-{turnId}.json` persists with stale activity data
5. No staged `turn-result.json` exists

### 1.2 What Happens on `step --resume` Today

1. `reconcileStaleTurns()` runs (step.js:132)
   - Ghost detection: skipped if turn has `first_output_at` (startup proof exists)
   - Stale detection: skipped if <10 minutes since `started_at`
2. If turn is still `active` + `running` and neither ghost nor stale: resume proceeds
3. `skipAssignment = true` (step.js:195)
4. New dispatch bundle written (step.js:440-446)
5. `transitionActiveTurnLifecycle(root, turnId, 'dispatched')` resets turn status, clears `started_at`, `worker_pid`, `first_output_at` (governed-state.js:977-984)
6. New subprocess spawned

### 1.3 Identified Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| **No PID liveness check** | High | If the old worker is still alive (not actually killed, just unresponsive), `step --resume` spawns a duplicate worker for the same turn. Two processes write to the same staging path. |
| **No crash detection log** | Medium | When re-dispatching after a kill, no event or log message distinguishes "crash recovery" from "normal resume." Recovery classification (run_5276bd12be02449a) cannot track crash recoveries without an event. |
| **Stale dispatch-progress** | Medium | Old `dispatch-progress-{turnId}.json` from the killed process persists. The new subprocess's progress tracker may read stale data (last_activity_at, output_lines) on startup. |
| **No attempt increment** | Low | The turn's `attempt` counter is not bumped on crash-recovery re-dispatch. Operators cannot see how many times a turn was restarted after crashes. |

---

## 2. Implementation Design

### 2.1 PID Liveness Guard in `step --resume` Path

**File:** `cli/src/commands/step.js`
**Location:** After target turn resolution (line ~195), before dispatch bundle write

**Logic:**
```javascript
// After line 195 (skipAssignment = true), before dispatch:
if (targetTurn.worker_pid != null) {
  const workerAlive = isWorkerAlive(targetTurn.worker_pid);
  if (workerAlive) {
    console.log(chalk.red(`Worker process (PID ${targetTurn.worker_pid}) is still alive.`));
    console.log(chalk.dim('The previous dispatch appears to still be running.'));
    console.log(chalk.dim('Wait for it to complete, or kill it first, then retry.'));
    process.exit(1);
  }
  // Worker is dead — crash recovery path
  console.log(chalk.yellow(`Detected crashed worker (PID ${targetTurn.worker_pid}). Re-dispatching turn ${targetTurn.turn_id}...`));
  cleanupStaleDispatchProgress(root, targetTurn.turn_id);
}
```

**Same guard applies to the blocked-turn resume path** (step.js, line ~275 area):
- After `reactivateGovernedRun()`, before `refreshTurnBaselineSnapshot()`, add the same PID check.

### 2.2 PID Liveness Utility

**File:** `cli/src/commands/step.js` (inline helper, not exported — only step.js needs it)

```javascript
function isWorkerAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}
```

Note: `governed-state.js:1190` already has `isProcessRunning(pid)` but it is unexported and used only for acceptance locks. Rather than exporting a private function, step.js defines its own inline version. This avoids coupling step.js to governed-state.js internals.

### 2.3 Dispatch Progress Cleanup

**File:** `cli/src/commands/step.js`

```javascript
function cleanupStaleDispatchProgress(root, turnId) {
  const progressPath = join(root, getDispatchProgressRelativePath(turnId));
  if (existsSync(progressPath)) {
    unlinkSync(progressPath);
  }
}
```

Called only in the crash-recovery path (dead PID detected). Ensures the new subprocess starts with a clean progress file.

### 2.4 Crash Recovery Event (stretch — optional for dev)

If dev has capacity, emit a `session_continuation` event with payload `{ reason: 'crash_recovery', previous_pid: <dead_pid>, turn_id: <turn_id> }` when crash is detected. This is NOT a new event type — it reuses the existing `session_continuation` event type already in `VALID_RUN_EVENTS`.

---

## 3. Files Changed

| File | Type | Change |
|------|------|--------|
| `cli/src/commands/step.js` | MODIFY | Add PID liveness guard + dispatch-progress cleanup in both resume paths (active + blocked) |
| `cli/test/step-crash-resume.test.js` | NEW | Tests for crash-recovery resume, duplicate-dispatch rejection, no-PID graceful fallback |

---

## Interface

### No New Exports

All changes are internal to `step.js` and test-only. No new public API is introduced.

### Behavioral Contract Change

`agentxchain step --resume` gains the following behavior when the target turn has `worker_pid` set:

| Worker PID State | Behavior |
|------------------|----------|
| Alive (`kill(pid, 0)` succeeds) | Print error: "Worker process still alive", exit 1 |
| Dead (`kill(pid, 0)` throws) | Print: "Detected crashed worker", clean dispatch-progress, proceed to re-dispatch |
| Not set (`worker_pid` is null/undefined) | No change — proceed as before (backwards compatible) |

---

## Dev Charter

### Scope

1. **Add PID liveness guard to step.js active-turn resume path** (after line ~195):
   - Check `targetTurn.worker_pid` liveness via `process.kill(pid, 0)`
   - If alive: print error + exit 1 (prevent duplicate dispatch)
   - If dead: log crash detection, call `cleanupStaleDispatchProgress(root, turnId)`
   
2. **Add PID liveness guard to step.js blocked-turn resume path** (after line ~276):
   - Same check after `reactivateGovernedRun()`, before baseline refresh
   - If alive: print error + exit 1
   - If dead: log crash detection, clean dispatch-progress

3. **Add `cleanupStaleDispatchProgress()` inline helper** to step.js:
   - Delete `dispatch-progress-{turnId}.json` if it exists
   - Import `getDispatchProgressRelativePath` from `dispatch-progress.js` and `unlinkSync` from `node:fs`

4. **Write `cli/test/step-crash-resume.test.js`** with these test cases:
   - **Crash recovery:** State has active running turn with `worker_pid` set to a known-dead PID (e.g., 999999). Create dispatch-progress file. Call the resume flow. Verify: dispatch-progress deleted, turn transitions to `dispatched`, no error exit.
   - **Duplicate dispatch rejection:** State has active running turn with `worker_pid` set to current process PID (`process.pid`, guaranteed alive). Call the resume flow. Verify: exits with error, no re-dispatch.
   - **No PID fallback:** State has active running turn with `worker_pid` undefined. Call the resume flow. Verify: proceeds normally (backwards compatible).
   - **Blocked-turn crash recovery:** State is `blocked` with retained turn, `worker_pid` dead. Call `step --resume`. Verify: reactivation + crash cleanup + re-dispatch.

### Test Implementation Notes

- Tests should use the same fixture pattern as `step-command.test.js`: temp directory, scaffolded governed state, direct function calls where possible
- For PID liveness: use PID `999999` (virtually certain to be dead) for crash tests, use `process.pid` for alive tests
- Do NOT spawn actual subprocesses — test the guard logic and state transitions only
- Import `getDispatchProgressRelativePath` from `dispatch-progress.js` to create/verify progress files

### Out of Scope

- Adding new event types to `VALID_RUN_EVENTS` (reuse `session_continuation` if emitting crash event)
- Modifying `reconcileStaleTurns()` or the ghost/stale watchdog logic
- Modifying `transitionActiveTurnLifecycle()` — the dispatched transition already resets worker_pid
- Bumping the `attempt` counter (follow-up item — requires schema consideration)
- Continuous-run loop crash handling (already handled by adapter subprocess tracking)
- Cold-start resume of failed sessions

### Verification

Dev must run `npm run test -- cli/test/step-crash-resume.test.js` and confirm all tests pass. Then run `npm run test` full suite to confirm no regressions.

## Acceptance Tests

- [x] `step --resume` with dead `worker_pid` on active running turn proceeds to re-dispatch (crash recovery verified)
- [x] `step --resume` with alive `worker_pid` on active running turn rejects with clear error (duplicate dispatch prevented)
- [x] `step --resume` with no `worker_pid` on active running turn proceeds normally (backwards compatible)
- [x] Stale `dispatch-progress-{turnId}.json` is deleted during crash recovery before re-dispatch
- [x] `npm run test` passes with no regressions
