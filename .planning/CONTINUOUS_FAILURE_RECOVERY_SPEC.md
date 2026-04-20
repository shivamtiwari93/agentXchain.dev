## Purpose

Define how continuous mode handles governed-run outcomes that are not successful completions.

This closes a truth gap in the repo-local lights-out surface: continuous sessions must not count failed or preempted runs as completed work, and they must preserve the existing intake/blocking contracts instead of fabricating a new `run_failed` lifecycle that the product does not ship.

## Interface

Continuous-mode behavior covered by this spec:

- `agentxchain run --continuous ...`
- schedule-owned continuous sessions via `agentxchain schedule daemon`
- `advanceContinuousRunOnce(context, session, contOpts, executeGovernedRun, log)`

No new user-facing command is required for this slice.

## Behavior

### Completed governed run

If the governed run completes successfully:

- increment `session.runs_completed`
- add any `budget_status.spent_usd` to `session.cumulative_spent_usd`
- resolve the current intake intent to `completed`
- keep the continuous session `running` for the next step until a terminal session limit is reached

### Blocked governed run

If the governed run ends in a blocked state, continuous mode must treat it as a recoverable pause, not a completed run.

Blocked detection is based on the governed result state, not only the top-level `stop_reason`. This includes:

- `result.state.status === "blocked"`
- `stop_reason === "blocked"`
- `stop_reason === "reject_exhausted"`
- other stop reasons that still yield `state.status === "blocked"`

When this happens:

- do **not** increment `session.runs_completed`
- add any spent budget from the blocked run
- resolve the current intake intent through the existing blocked-intent projection
- set `session.status = "paused"`
- return a blocked continuous step (`action: "run_blocked"`)

### Priority preemption

If the governed run yields `priority_preempted`:

- do **not** increment `session.runs_completed`
- do **not** resolve the current intake intent
- keep the session `running`
- consume the injected priority on the next cycle

This preserves the current run/intent instead of lying that the interrupted work completed.

### Non-blocked governed failure

If the governed run exits unsuccessfully without reaching blocked state, continuous mode must fail the session truthfully.

Examples:

- dispatch callback throws (`dispatch_error`)
- executor throws before returning a governed result
- malformed adapter result that aborts the run without transitioning governed state to `blocked`

When this happens:

- do **not** increment `session.runs_completed`
- add any spent budget visible in the governed result
- leave the current intake intent unresolved (`executing`)
- set `session.status = "failed"`
- preserve `current_run_id` / `current_vision_objective` for inspection
- return a failed continuous step (`action: "run_failed"`)

This does **not** invent a new intake `run_failed_at` contract. The product still only ships `completed` and `blocked` projections for repo-backed intents.

## Error Cases

1. Governed executor throws before returning a result.
   Continuous mode marks the session `failed` and stops immediately.

2. Governed run stops with `priority_preempted`.
   Continuous mode must not increment completed-run counters or resolve the intent.

3. Governed run stops with `reject_exhausted`.
   Continuous mode must recognize the blocked run state and pause the session instead of reporting `running`.

## Acceptance Tests

- `AT-CONT-FAIL-001`: `advanceContinuousRunOnce()` with `stop_reason: "dispatch_error"` returns `{ ok: false, status: "failed", action: "run_failed" }`, keeps `runs_completed` unchanged, and leaves the intake intent `executing`.
- `AT-CONT-FAIL-002`: `advanceContinuousRunOnce()` with `stop_reason: "priority_preempted"` keeps `runs_completed` unchanged and leaves the intent `executing`.
- `AT-CONT-FAIL-003`: `agentxchain run --continuous ...` with a failing local CLI agent that exhausts retries pauses the session with `status: "paused"`, preserves `runs_completed: 0`, and resolves the intake intent to `blocked` with truthful recovery metadata.
- `AT-CONT-FAIL-004`: schedule-compatible primitive treats `reject_exhausted` + `state.status: "blocked"` as `run_blocked`, not a successful continuous step.
- `AT-CONT-FAIL-005`: paused session stays blocked (`still_blocked`) when governed state is still blocked — guard prevents re-advancing.
- `AT-CONT-FAIL-006`: paused session resumes when governed state is unblocked — run completes, `runs_completed` increments.
- `AT-SCHED-CONT-FAIL-001`: daemon E2E — schedule-owned continuous session hits a blocked run, daemon records `continuous_blocked`, keeps polling with `still_blocked` cycles, resumes after the surfaced recovery action, and completes the run with stable `session_id`. The proof must cover at least the `needs_human -> unblock` path.

## Open Questions

- None for this slice. Live-adapter dogfood can build on this failure contract later, but it does not change the repo-local behavior defined here.
