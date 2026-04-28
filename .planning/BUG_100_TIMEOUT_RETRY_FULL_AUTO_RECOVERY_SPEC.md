# BUG-100 Timeout Retry Full-Auto Recovery Spec

## Purpose

Keep DOGFOOD-100 full-auto when a local CLI turn is productive but misses the hard turn deadline before staging a result.

BUG-100 was discovered after `agentxchain@2.155.53` cleared BUG-99 on tusq.dev. Dev turn `turn_317ed718994e61ef` produced substantial stdout on both attempts, but each attempt was killed at the 1,200 second deadline before writing `.agentxchain/staging/<turn>/turn-result.json`. The framework exhausted retries and raised a human escalation, blocking the continuous loop.

## Interface

- Component: `executeContinuousRun()` / `advanceContinuousRunOnce()` in `cli/src/lib/continuous-run.js`.
- Existing recovery primitive: `reissueTurn(root, config, { turnId, reason })`.
- Existing blocker shape: governed state with `blocked_reason.category === "retries_exhausted"` and retained failed active turn.
- New continuous-session field: `productive_timeout_retry`.
- New events:
  - `auto_retried_productive_timeout`
  - `productive_timeout_retry_exhausted`

## Behavior

- In continuous mode, when startup state or an active run blocks on `retries_exhausted`, inspect the retained failed active turn before pausing.
- A turn is eligible for productive-timeout auto-retry only when:
  - the active turn is retained with `status: "failed"`;
  - `last_rejection.failed_stage === "dispatch"`;
  - the rejection reason indicates a deadline-killed local CLI subprocess (`code 143` or timeout wording);
  - the turn recorded `first_output_at`;
  - no staged turn result exists for that turn.
- Eligible turns are reissued under the same role with reason `auto_retry_productive_timeout`.
- The reissued turn receives an extended deadline of 60 minutes and a `timeout_recovery_context` block pointing back to the timed-out turn.
- Continuous mode clears the blocked state and continues without `unblock`, staging edits, gate mutation, or operator recovery.
- The retry budget is one productive-timeout auto-reissue per run. Exhaustion pauses rather than looping forever.
- Existing ghost-turn auto-retry remains unchanged and runs after productive-timeout detection.

## Error Cases

- Silent hung turns without `first_output_at` are not eligible.
- Generic subprocess failures without timeout/deadline evidence are not eligible.
- Turns that already staged a result are not auto-reissued by this path; acceptance owns that recovery.
- If `reissueTurn()` fails, the original blocked state remains intact.
- If the one auto-retry is already spent for the run, the framework leaves the run blocked and emits `productive_timeout_retry_exhausted`.

## Acceptance Tests

- A continuous-run regression seeds a blocked `retries_exhausted` state with a productive deadline-killed retained turn and proves `advanceContinuousRunOnce()` reissues the turn, clears the blocker, extends the deadline, writes `productive_timeout_retry`, and emits `auto_retried_productive_timeout`.
- A negative regression proves a silent retained `retries_exhausted` turn is not auto-reissued.
- A command-chain regression should cover `agentxchain run --continuous` resuming the seeded blocked state without `unblock`.

## Open Questions

- Whether 60 minutes should become configurable per runtime or role after DOGFOOD-100 gathers more timeout evidence.
