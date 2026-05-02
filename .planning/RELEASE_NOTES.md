# Release Notes

## User Impact

Operators running `agentxchain run --continuous` will no longer experience two ghost auto-retry recovery bugs:

- **Session status consistency (Bug A):** After ghost auto-retry clears a blocker, `session.json` now correctly reflects `run_status: 'active'` instead of retaining the stale `run_status: 'blocked'` from the pre-clear checkpoint. This prevents downstream tools and restart logic from misreading the session as blocked.
- **Loop resilience (Bug B):** When a transient `executeGovernedRun()` failure occurs but the governed run is still active with matching run ID, the continuous loop now recovers and retries instead of exiting terminally. An audit event (`session_failed_recovered_active_run`) is emitted for observability.

Both fixes apply to all 4 ghost auto-retry recovery paths: Claude Node runtime recovery, Claude auth refresh, productive timeout retry, and ghost turn auto-retry.

## Verification Summary

- 441 tests across 9 suites independently verified by QA, 0 failures
- BUG-115 ghost checkpoint test: session.json has `run_status: 'active'`, `blocked: false`, `checkpoint_reason: 'blocker_cleared'` after clear
- BUG-115 loop recovery test: transient failure with active governed run → session recovered, loop continues, completes on second execution
- BUG-115 negative test: inactive governed run failure → loop exits terminally (existing behavior preserved)
- All AGENT-TALK guard tests pass (8/8)
