# BUG-107 Continuous Paused Active Run Recovery Spec

## Purpose

Prevent Full Auto Mode from silently stopping after a clean accepted turn when the continuous session is marked `paused` even though the governed run is still `active`, unblocked, and has a dispatchable next role.

This was discovered during the tusq.dev DOGFOOD-100 run on `agentxchain@2.155.60`: dev turn `turn_fc4027d5c8789062` accepted cleanly, the run advanced from `implementation` to `qa`, but the continuous runner process exited and left `.agentxchain/continuous-session.json` at `status: "paused"` with no blocker and no active turn.

## Interface

- `isPausedContinuousSessionRecoverableActiveRun(session, state, config)` returns `true` only for active-run shapes that are safe to continue.
- `advanceContinuousRunOnce()` resumes this shape by setting the session back to `running` and continuing the existing governed run.
- `executeContinuousRun()` adopts an existing non-terminal CLI-owned continuous session on startup instead of replacing it, then re-checks the on-disk session after each step and continues if another path wrote the same recoverable paused shape.
- Recovery emits `continuous_paused_active_run_recovered`.
- Startup adoption emits `continuous_session_resumed`.

## Behavior

- Recover when all conditions hold:
  - continuous session status is `paused`
  - governed state status is `active`
  - session and state refer to the same run, when both run IDs are present
  - no blocker, escalation, pending approval, or queued approval exists
  - either a retained active turn exists with a dispatchable status (`assigned`, `dispatched`, `starting`, or `running`) and can be resumed by the governed run loop, or no active turns exist and normal role resolution can select a next role from `next_recommended_role` or routing entry role
- Do not recover legitimate pauses:
  - blocked governed state
  - pending phase approval
  - pending run-completion approval
  - queued phase or run-completion approval
  - failed retained active turns, including `failed_acceptance`, because those require the existing failed-turn recovery path instead of continuous auto-recovery
  - missing or illegal next role
- Preserve the continuous session ID when a shipped CLI command is reinvoked against a paused or running CLI-owned session with the same vision path. This is required so DOGFOOD-100 can reverify `cont-7dc5b5df` rather than silently starting a fresh proof session.

## Error Cases

- If the governed state is blocked, existing blocker handling remains authoritative.
- If the session is paused for a real approval gate, the session remains paused.
- If the session run ID and governed state run ID disagree, recovery is refused.
- If no retained active turn exists and role resolution cannot produce a valid role, recovery is refused.
- Schedule-owned sessions are not adopted by CLI startup; the schedule daemon continues to own those sessions through `advanceContinuousRunOnce()`.

## Acceptance Tests

- `AT-CONT-FAIL-007`: paused session + active unblocked run + no active turns + valid next QA role is recoverable.
- `AT-CONT-FAIL-008`: paused session + pending phase approval is not auto-recoverable.
- `AT-CONT-FAIL-009`: paused session + pending phase approval remains paused instead of dispatching.
- `AT-CONT-FAIL-010`: paused active run with a retained active turn is recoverable after unblock.
- `AT-CONT-FAIL-011`: paused active run with a failed retained active turn is not auto-recoverable.
- `AT-BUG107-001`: CLI-owned `executeContinuousRun()` preserves an existing paused active session ID and resumes it instead of replacing `.agentxchain/continuous-session.json`.
- Existing `AT-CONT-FAIL-006` continues to prove a paused session resumes after an unblock.
- Existing `AT-SCHED-CONT-FAIL-001` continues to prove schedule-owned blocked sessions keep polling, resume after unblock, and retain their stable session ID.

## Open Questions

- The DOGFOOD-100 evidence did not show a `caller_stopped`, `session_failed`, `run_blocked`, or `human_escalation_raised` event. The exact writer that set the session to `paused` after `turn_fc4027d5c8789062` accepted is still inferred from state shape rather than directly identified. The fix is intentionally defensive at the continuous-session boundary.
