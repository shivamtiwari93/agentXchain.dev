# Release Notes

## User Impact

This release hardens the `agentxchain step --resume` crash-recovery path with **PID liveness detection** and **stale dispatch-progress cleanup**, preventing duplicate worker dispatch and stale progress data after a killed mid-turn process.

- **PID liveness guard on resume:** When `step --resume` encounters an active or blocked turn with a recorded `worker_pid`, it now checks whether that process is still alive via `process.kill(pid, 0)`. If alive, the resume is rejected with a clear error ("Worker process (PID N) is still alive") and exit code 1, preventing duplicate dispatch of two workers on the same turn. If dead, the resume proceeds normally with crash-recovery logging.

- **Stale dispatch-progress cleanup:** When crash recovery is detected (dead worker PID), the stale `dispatch-progress-{turnId}.json` file from the killed process is automatically deleted before re-dispatch. This ensures the new worker starts with a clean progress tracker, preventing stale `last_activity_at` and `output_lines` data from misleading the watchdog system.

- **Backwards compatible:** Turns without a recorded `worker_pid` (pre-existing state or manual adapter turns) are unaffected — resume proceeds as before with no liveness check.

- **Blocked-turn crash recovery:** The PID guard also covers the blocked-turn resume path. If a run was blocked with a retained turn from a crashed worker, `step --resume` now detects the dead PID, cleans dispatch-progress, reactivates the run, and re-dispatches the turn in one operation.

## Verification Summary

- Full suite: 665 test files, 7386 tests, 0 failures — independently run to completion by QA
- Targeted crash-resume tests: 4/4 pass (active crash recovery, alive-PID rejection, no-PID backwards compat, blocked-turn crash recovery)
- Vitest contract + crash-resume combined: 15/15 pass
- AGENT-TALK guard tests: 8/8 pass
- No whitespace issues (`git diff --check` clean)
- ROADMAP.md M4 item "Improve checkpoint-restore" checked off with run evidence
