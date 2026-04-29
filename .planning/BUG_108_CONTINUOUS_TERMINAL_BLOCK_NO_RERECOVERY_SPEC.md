# BUG-108 Continuous Terminal Block No Re-Recovery Spec

## Purpose

Prevent Full Auto Mode from tight-looping after a recovered paused active continuous session reaches a real terminal blocked step.

This was discovered during the tusq.dev BUG-107 shipped-package reverify on `agentxchain@2.155.61`: the CLI preserved session `cont-7dc5b5df`, emitted the paused-active recovery path, and attempted the natural QA dispatch. The governed run then returned a terminal blocked result because actor-owned product files were dirty. `executeContinuousRun()` incorrectly ran its post-step paused-active recovery before honoring `step.status === "blocked"`, so it repeatedly retried the same blocked assignment.

## Interface

- `executeContinuousRun()` must process terminal step statuses before invoking post-step `recoverPausedActiveContinuousSession()`.
- Terminal statuses include `completed`, `idle_exit`, `failed`, `blocked`, `stopped`, `vision_exhausted`, `vision_expansion_exhausted`, and `session_budget`.
- `recoverPausedActiveContinuousSession()` remains available for non-terminal defensive recovery only.

## Behavior

- When `advanceContinuousRunOnce()` returns `status: "blocked"`, continuous execution returns immediately with the terminal blocked result.
- The post-step paused-active recovery hook must not run for terminal blocked results.
- The existing BUG-107 startup/adopt/recover path must continue to resume a genuinely recoverable paused active run before it enters the governed run loop.

## Error Cases

- A real assignment blocker, dirty-baseline blocker, policy blocker, or gate blocker must not be flattened into recoverable paused-active work.
- A killed or interrupted continuous process may still leave a stale `running` session, but CLI startup adoption already permits non-terminal CLI-owned `running` sessions with matching vision path.

## Acceptance Tests

- `AT-BUG108-001`: `executeContinuousRun()` resumes an existing paused active session, receives a terminal blocked step, calls the governed executor only once, and does not invoke post-step paused-active re-recovery.
- `AT-BUG107-001` remains passing: CLI-owned continuous startup still preserves an existing paused active session ID and resumes it.

## Open Questions

- The tusq.dev dirty-baseline blocker after the recovered QA dispatch may be a separate dogfood blocker if the dirty actor-owned files should have been checkpointed by the previous dev turn. BUG-108 only fixes the tight-loop response to that terminal blocked result.
