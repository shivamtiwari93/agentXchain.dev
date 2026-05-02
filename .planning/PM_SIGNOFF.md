# PM Signoff — M4: Checkpoint-Restore Verification for Killed Mid-Turn Processes

Approved: YES

**Run:** `run_da40a332eed44f56`
**Phase:** planning
**Turn:** `turn_2e7be194079f7f54`
**Date:** 2026-05-02

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running governed or continuous sessions where the orchestrator process (`agentxchain step`) may be killed mid-turn — by OOM, `kill -9`, terminal close, or machine restart — and who need to resume cleanly via `step --resume`.

### Core Pain Point

When `agentxchain step` is killed while a worker subprocess is active, `step --resume` re-dispatches the turn without checking whether the old worker is still alive. This creates two risks: (1) duplicate workers writing to the same staging path if the "killed" process is actually still running, and (2) stale `dispatch-progress` files misleading the new worker's monitoring. The existing path works mechanically but lacks crash detection, safety guards, and test coverage.

### Root Cause

The `step --resume` path (step.js:161-217, 226-319) was designed for normal resume (blocked/paused runs) and adapted for active-turn re-dispatch. It skips assignment and writes a new dispatch bundle, but never checks whether the previous worker subprocess (`worker_pid` on the turn) is still alive. The `isProcessRunning(pid)` utility exists in governed-state.js (line 1190) but is only used for the acceptance lock, not for dispatch safety.

### Core Workflow

1. PM (this turn) — Audits the crash-resume path, identifies gaps, charters dev with bounded scope
2. Dev — Adds PID liveness guard to step.js resume paths, writes crash-resume tests
3. QA — Verifies PID guard behavior, test coverage, no regressions

### MVP Scope (this run)

**PM deliverables (this turn):**
1. SYSTEM_SPEC.md: Gap analysis, PID liveness guard design, dev charter with file-level scope
2. Bounded scope: 1 modified file + 1 new test file

**Dev deliverables:**
1. `cli/src/commands/step.js` — PID liveness guard in both resume paths (active + blocked), dispatch-progress cleanup for dead workers
2. `cli/test/step-crash-resume.test.js` — 4 test cases: crash recovery, duplicate rejection, no-PID fallback, blocked-turn crash recovery

### Out of Scope

- New event types in `run-events.js` (no `turn_crash_detected` — reuse existing types if needed)
- Modifying `reconcileStaleTurns()` or ghost/stale watchdog thresholds
- Attempt counter increment on crash re-dispatch (schema consideration for follow-up)
- Continuous-run loop crash handling (already covered by adapter subprocess tracking)
- Cold-start resume of failed sessions
- Bumping dispatch-progress to track crash count (follow-up)
- The ROADMAP.md:64 acceptance item ("simulated crash during dev turn recovers cleanly via `step --resume`") — that covers the full M4 milestone acceptance, not just this single item

### Success Metric

1. `step --resume` rejects re-dispatch when worker PID is alive (prevents duplicate dispatch)
2. `step --resume` detects dead worker PID and logs crash recovery before re-dispatching
3. Stale `dispatch-progress-{turnId}.json` is cleaned up during crash recovery
4. All 4 test cases pass in `step-crash-resume.test.js`
5. `npm run test` full suite passes with no regressions
6. ROADMAP.md:62 checked off

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| PID 999999 could theoretically be alive during test | Negligible | Use a PID higher than typical system range; CI environments have low PID counts |
| `process.kill(pid, 0)` may behave differently cross-platform | Low | Node.js docs guarantee signal-0 semantics on all supported platforms (macOS, Linux, Windows) |
| Rejecting alive-PID resume could block legitimate recovery | Low | Error message is clear: "kill it first, then retry." Operator retains full control. |
| Dispatch-progress deletion could race with another process reading it | Low | `step --resume` is single-invocation; no concurrent readers expected during resume |

## Challenge to Previous Work

### OBJ-PM-001: Previous planning artifacts describe a different feature (severity: high)

The PM_SIGNOFF.md and SYSTEM_SPEC.md from run `run_5276bd12be02449a` describe "Structured Recovery Classification in Governance Reports" — a completed feature (ROADMAP.md:61 is checked `[x]`). This run's intent targets ROADMAP.md:62: "Improve checkpoint-restore: verify a killed mid-turn process can cleanly resume." The planning artifacts have been rewritten from scratch for the correct charter.

### OBJ-PM-002: The crash-resume path has no test coverage (severity: medium)

Despite `step --resume` being the documented recovery command for crashed turns, there are zero tests that simulate a killed process and verify clean resume. The `step-command.test.js` tests normal turn lifecycle; `continuity-checkpoint-contract.test.js` tests checkpoint read/write; `stale-turn-watchdog.test.js` tests ghost/stale detection. None test the "active turn + dead PID + step --resume" path.

## Notes for Dev

**Your charter is 1 code change + 1 test file:**

Modify `cli/src/commands/step.js` to add a PID liveness guard in both resume paths per SYSTEM_SPEC.md Section 2.1. The guard fires after target turn resolution but before dispatch bundle write.

There are two resume paths in step.js that need the guard:
1. **Active-turn resume** (line ~195): `state.status === 'active' && opts.resume` — add guard between `skipAssignment = true` and the dispatch bundle write at line ~440
2. **Blocked-turn resume** (line ~276): `state.status === 'blocked' && activeCount > 0 && opts.resume` — add guard after `reactivateGovernedRun()` but before `refreshTurnBaselineSnapshot()`

Import `getDispatchProgressRelativePath` from `dispatch-progress.js` and `unlinkSync` from `node:fs`.

**Test expectations:**
- `step-crash-resume.test.js`: 4 test cases per SYSTEM_SPEC.md Dev Charter
- Use state fixtures (not subprocess spawning) — construct `state.json` with active turn + worker_pid
- PID 999999 for dead worker, `process.pid` for alive worker
- Verify state transitions, file cleanup, and error exits

## Notes for QA

- Verify the PID guard fires in BOTH resume paths (active + blocked)
- Verify crash detection message is logged when dead PID detected
- Verify dispatch-progress cleanup occurs before re-dispatch
- Verify alive-PID rejection exits with code 1 and clear message
- Verify no-PID case (worker_pid undefined) proceeds without error (backwards compatible)
- Run `npm run test` — all tests including new ones must pass
- Verify no existing tests broken by the step.js changes

## Acceptance Contract

1. **Roadmap milestone addressed:** M4: Recovery & Resilience Hardening
2. **Unchecked roadmap item completed:** Improve checkpoint-restore: verify a killed mid-turn process can cleanly resume — checked `[x]` at ROADMAP.md:62
3. **Evidence source:** .planning/SYSTEM_SPEC.md (gap analysis + design), `cli/test/step-crash-resume.test.js` (verification evidence)
