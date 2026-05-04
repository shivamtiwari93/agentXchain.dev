# System Spec — Simulated Crash Recovery Acceptance Test

**Run:** `run_5723929be7513f77`
**Baseline:** git:e8a1cda5b (HEAD at planning start)
**Package version:** `agentxchain@2.155.72`

## Purpose

Add one acceptance-grade integration test that exercises a real OS PID lifecycle (spawn → kill → death detection → resume) to satisfy ROADMAP.md:64: "Acceptance: simulated crash during dev turn recovers cleanly via `step --resume`".

**No runtime code changes.** All crash-resume logic was shipped in run_da40a332eed44f56. This run adds the missing acceptance test.

---

## 1. Existing Infrastructure

The crash-resume flow implemented in `step.js`:

```
step --resume (active/running turn)
  → guardResumeWorkerLiveness(root, turn)          [step.js:1045]
    → isWorkerAlive(turn.worker_pid)                [step.js:1061]
      → process.kill(pid, 0)                        [OS signal probe]
        ├─ alive: fatal exit(1) "Worker still alive"
        └─ dead (ESRCH): proceed
    → cleanupStaleDispatchProgress(root, turnId)    [step.js:1075]
  → transitionActiveTurnLifecycle(..., 'dispatched') [clears worker_pid]
  → dispatchLocalCli()                              [fresh subprocess]
```

### Existing Tests (step-crash-resume.test.js)

| # | Test | PID Source | Coverage |
|---|------|-----------|----------|
| 1 | Dead PID re-dispatch | `DEAD_PID = 99999999` (never existed) | Guard allows resume, progress cleaned |
| 2 | Alive PID rejection | `process.pid` (test process) | Guard blocks resume |
| 3 | No-PID backward compat | `null` | Guard skips, dispatch proceeds |
| 4 | Blocked retained turn | `DEAD_PID = 99999999` | Blocked→active→re-dispatch |

**Gap:** No test spawns a real process, kills it, and verifies recovery. `DEAD_PID = 99999999` tests the "PID doesn't exist" path (`ESRCH` from `process.kill`), which is the same error code as a killed process — but never exercises the full lifecycle.

---

## 2. New Test Specification

**File:** `cli/test/step-crash-resume.test.js` (append to existing describe block)

### Test: "recovers cleanly after a simulated process crash (real PID lifecycle)"

**Scenario:** A dev turn is dispatched and running. The subprocess crashes (SIGKILL). Operator runs `step --resume`. The system detects the dead PID, cleans up stale progress, and re-dispatches.

### Steps

```javascript
it('recovers cleanly after a simulated process crash (real PID lifecycle)', async () => {
  // ── Setup ───────────────────────────────────────────────────────────
  const root = makeTmpDir();
  tmpDirs.push(root);
  const { state, turn } = setupProject(root);

  // ── Spawn a real subprocess ─────────────────────────────────────────
  // node -e "process.stdin.resume()" creates a process that stays
  // alive indefinitely (stdin keeps the event loop open).
  const child = spawn('node', ['-e', 'process.stdin.resume()'], {
    stdio: 'pipe',
    detached: false,
  });

  // Ensure cleanup if test fails mid-flight
  const cleanup = () => { try { child.kill('SIGKILL'); } catch {} };

  try {
    // ── Record real PID in governed state ────────────────────────────
    const runningState = setRunningTurn(root, turn.turn_id, child.pid);
    writeDispatchProgress(root, turn.turn_id, child.pid);
    writeStagedTurnResult(root, runningState);

    const progressPath = join(root, getDispatchProgressRelativePath(turn.turn_id));
    assert.equal(existsSync(progressPath), true, 'progress file exists before crash');

    // Confirm the process is actually alive
    assert.doesNotThrow(() => process.kill(child.pid, 0), 'spawned process is alive');

    // ── Simulate crash: kill with SIGKILL ───────────────────────────
    child.kill('SIGKILL');
    await new Promise((resolve) => child.on('exit', resolve));

    // Confirm the process is now dead
    assert.throws(
      () => process.kill(child.pid, 0),
      { code: 'ESRCH' },
      'killed process is dead'
    );

    // ── Run step --resume ───────────────────────────────────────────
    await runStep(root);

    // ── Verify recovery ─────────────────────────────────────────────
    // 1. Stale dispatch-progress cleaned up
    assert.equal(existsSync(progressPath), false, 'stale progress file removed');

    // 2. dispatchLocalCli called (re-dispatch happened)
    expect(dispatchLocalCli).toHaveBeenCalledTimes(1);

    // 3. State transitioned to 'dispatched' with cleared worker_pid
    const dispatchedState = dispatchLocalCli.mock.calls[0][1];
    assert.equal(
      dispatchedState.active_turns[turn.turn_id].status,
      'dispatched',
      'turn re-dispatched'
    );
    assert.equal(
      dispatchedState.active_turns[turn.turn_id].worker_pid,
      undefined,
      'worker_pid cleared for fresh dispatch'
    );
  } finally {
    cleanup();
  }
});
```

### Required Import Addition

Add to the existing imports at the top of the file:

```javascript
import { spawn } from 'child_process';
```

### Design Rationale

1. **Real PID lifecycle** — Unlike `DEAD_PID = 99999999`, this test spawns a real OS process, confirms it's alive (`process.kill(pid, 0)` succeeds), kills it with SIGKILL, and confirms it's dead (`process.kill(pid, 0)` throws ESRCH). This exercises the exact code path that occurs during a real crash.

2. **SIGKILL, not SIGTERM** — SIGKILL is unblockable and immediate, simulating a hard crash (OOM kill, power loss, `kill -9`). SIGTERM would allow graceful shutdown, which is not a crash.

3. **Wait for exit event** — `child.on('exit', resolve)` ensures the OS has fully reaped the process before testing the liveness guard. This eliminates any race condition where the PID is still in a zombie state.

4. **Mocked dispatch preserved** — The re-dispatch itself remains mocked via `vi.mock('../src/lib/adapters/local-cli-adapter.js')`. The value of this test is in the real PID lifecycle, not in testing the dispatch mechanism (which has its own test coverage).

5. **try/finally cleanup** — If the test fails before killing the child, the finally block ensures no orphan processes are left.

---

## Dev Charter

### Scope

**Change 1: New test in `cli/test/step-crash-resume.test.js`**
- Add `import { spawn } from 'child_process';` to existing imports
- Add one test: "recovers cleanly after a simulated process crash (real PID lifecycle)"
- Test body follows the specification in Section 2 above
- ~35 LOC delta

### Out of Scope

- Runtime code changes (none needed)
- New test files (append to existing file)
- New mock agent scripts (test uses `node -e "process.stdin.resume()"`)
- Changes to existing 4 tests (preserve as-is)

### Verification

Dev must confirm:
1. `npm test` passes with 0 failures
2. The new test exercises a real spawned process PID, not DEAD_PID
3. The test confirms the process is alive before killing and dead after killing
4. All 5 tests in the `step --resume crash recovery` describe block pass

## Acceptance Tests

- [ ] Test spawns a real child process via `child_process.spawn` and captures `child.pid`
- [ ] Test records `child.pid` in governed state as `worker_pid` (not DEAD_PID constant)
- [ ] Test confirms process is alive before kill: `process.kill(child.pid, 0)` does not throw
- [ ] Test kills process with SIGKILL and waits for exit event
- [ ] Test confirms process is dead after kill: `process.kill(child.pid, 0)` throws ESRCH
- [ ] `step --resume` detects dead PID, cleans dispatch-progress, re-dispatches turn
- [ ] State transitions to `dispatched` with `worker_pid` cleared
- [ ] All 5 tests in `step-crash-resume.test.js` pass
- [ ] `npm test` passes with 0 failures
