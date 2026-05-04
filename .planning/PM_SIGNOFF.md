# PM Signoff — Simulated Crash Recovery Acceptance Test

Approved: YES

**Run:** `run_5723929be7513f77`
**Phase:** planning
**Turn:** `turn_79159e88f326080d`
**Date:** 2026-05-03

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators who encounter mid-turn process crashes during governed runs and need confidence that `step --resume` will recover cleanly.

### Core Pain Point

ROADMAP.md:62 shipped the crash-resume infrastructure: PID liveness guard, stale dispatch-progress cleanup, and 4 regression tests. But those tests use `DEAD_PID = 99999999` — a PID that never existed — and mock `dispatchLocalCli` entirely. The acceptance criterion at ROADMAP.md:64 requires proving this works with a **real process lifecycle**: spawn a subprocess, kill it (simulating a crash), then verify `step --resume` detects the dead PID and recovers cleanly.

This is a test-only gap. The runtime code is complete and correct. What's missing is an acceptance-grade test that exercises real OS PID lifecycle semantics rather than synthetic non-existent PIDs.

### Root Cause of the Gap

The existing 4 tests in `step-crash-resume.test.js` were designed as unit tests for the guard logic. They prove:
1. Dead PID (99999999) → re-dispatch ✓
2. Alive PID (process.pid) → rejection ✓
3. No PID (legacy) → backward compat ✓
4. Blocked retained turn → re-dispatch ✓

None of them spawn a real child process, kill it, and then prove recovery. The `DEAD_PID = 99999999` shortcut means the test never exercises the `process.kill(pid, 0)` → ESRCH error path that occurs with a genuinely killed process.

### Core Workflow

1. **PM (this turn)** — Charter dev with a bounded test-only scope
2. **Dev** — Adds 1 new test that spawns+kills a real process, verifies crash resume
3. **QA** — Confirms the test passes, acceptance criterion met, checks off ROADMAP.md:64

### MVP Scope (this run)

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Feature planning with dev charter
2. SYSTEM_SPEC.md: Technical spec for the new test
3. ROADMAP.md: Phases table updated for this run

**Dev deliverables:**
1. One new test in `cli/test/step-crash-resume.test.js`: "simulated crash: spawns real subprocess, kills it via SIGKILL, verifies step --resume recovers cleanly"
2. No runtime code changes

### Out of Scope

- Runtime code changes to crash-resume logic (already shipped in run_da40a332eed44f56)
- Full unmocked e2e test with real agent dispatch (the re-dispatch can remain mocked; the value is in the real PID lifecycle)
- Changes to `guardResumeWorkerLiveness`, `isWorkerAlive`, or `cleanupStaleDispatchProgress`
- New mock-agent scripts (the test spawns a simple `node -e "..."` process, no agent logic needed)
- Cost tracking, budget changes, or any other M4 items

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Test spawns a real child process and records its PID in governed state | Test code inspection |
| 2 | Test kills the process with SIGKILL (simulated crash) | Test code inspection |
| 3 | Test confirms `step --resume` detects dead PID and re-dispatches | Assertion: `dispatchLocalCli` called, state transitions to `dispatched`, `worker_pid` cleared |
| 4 | Test confirms stale dispatch-progress file is cleaned up | Assertion: progress file deleted |
| 5 | `npm test` passes with 0 failures | CI / local test run |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Spawned process doesn't die fast enough after SIGKILL | Very Low | SIGKILL is unblockable; add a brief wait (50ms) to ensure OS reclaims PID |
| PID reuse by OS between kill and resume check | Extremely Low | Test runs in <100ms; PID reuse requires full PID space wrap-around |
| Test flakiness on CI due to process cleanup timing | Low | Use `child.on('exit')` callback to wait for confirmed death before resuming |

## Challenge to Previous Work

### OBJ-PM-001: Previous planning artifacts describe a different feature (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all describe turn-level cost tracking for local_cli runtimes from run `run_9a37a5dc395bc9b8`. This run's intent is ROADMAP.md:64: "Acceptance: simulated crash during dev turn recovers cleanly via `step --resume`". All three artifacts rewritten from scratch.

### OBJ-PM-002: Existing crash-resume tests are necessary but insufficient for acceptance (severity: medium)

The 4 existing tests in `step-crash-resume.test.js` validate the guard logic with synthetic PIDs. They are correct and should be preserved. The gap is that none exercises a real OS PID lifecycle (spawn → kill → PID death detection). The acceptance test adds this coverage without replacing the existing tests.

## Notes for Dev

**Your charter is a single new test. No runtime code changes.**

Add one test to `cli/test/step-crash-resume.test.js` inside the existing `describe('step --resume crash recovery')` block:

```
it('recovers cleanly after a simulated process crash (real PID lifecycle)', async () => {
  // 1. Set up governed project (reuse setupProject helper)
  // 2. Spawn a real child process: child_process.spawn('node', ['-e', 'process.stdin.resume()'])
  //    This creates a process that stays alive until killed.
  // 3. Transition turn to 'running' with child.pid as worker_pid
  // 4. Write dispatch-progress with child.pid
  // 5. Write staged turn result (for acceptance after re-dispatch)
  // 6. Kill the child process: child.kill('SIGKILL')
  // 7. Wait for confirmed death: await new Promise(resolve => child.on('exit', resolve))
  // 8. Verify: process.kill(child.pid, 0) throws (PID is dead)
  // 9. Run step --resume
  // 10. Assert: dispatch-progress cleaned up, dispatchLocalCli called, state = 'dispatched', worker_pid cleared
})
```

**Key details:**
- Import `spawn` from `child_process` (add to existing imports)
- Use `node -e "process.stdin.resume()"` as the subprocess — it stays alive until killed, no file I/O needed
- Wait for the `exit` event after SIGKILL to ensure the PID is fully reclaimed before running resume
- All other test infrastructure (setupProject, setRunningTurn, runStep, etc.) already exists — reuse them
- The `dispatchLocalCli` mock remains — we're testing the PID liveness guard with a real dead PID, not the full dispatch cycle

## Notes for QA

- Verify the new test spawns a real process and kills it (not using DEAD_PID constant)
- Verify the test waits for confirmed process death before running resume
- Verify all 5 existing tests still pass alongside the new one
- Run full test suite: `cd cli && npm test`
- After ship: ROADMAP.md:64 should be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M4: Recovery & Resilience Hardening** — ROADMAP.md:59
2. **Unchecked roadmap item completed: Acceptance: simulated crash during dev turn recovers cleanly via `step --resume`** — ROADMAP.md:64
3. **Evidence source: .planning/ROADMAP.md:64** — Item will be checked off after QA ship approval
