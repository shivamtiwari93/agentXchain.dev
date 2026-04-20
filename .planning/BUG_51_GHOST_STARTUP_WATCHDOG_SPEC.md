Status: Active — startup lifecycle hardening landed on HEAD; remains open pending tester verification per discipline rule #12

# BUG-51 Ghost Startup Watchdog Spec

## Purpose

Close the ghost-dispatch failure mode where a turn is marked `running`, the
dispatch bundle exists, but no worker output channel ever attaches. The
framework must detect that startup failure within 30 seconds instead of waiting
for the 10-minute stale-turn watchdog.

## Interface

- `cli/src/lib/stale-turn-watchdog.js`
  - `detectGhostTurns(root, state, config)`
  - `reconcileStaleTurns(root, state, config)`
- `failTurnStartup(root, state, config, turnId, details)`
- `cli/src/lib/governed-state.js`
  - `transitionActiveTurnLifecycle(root, turnId, nextStatus, options)`
- `cli/src/lib/adapters/local-cli-adapter.js`
  - `dispatchLocalCli(..., { onSpawnAttached, onFirstOutput, startupWatchdogMs })`
- `agentxchain status`
- `agentxchain status --json`
- `agentxchain resume`
- `agentxchain step`
- `agentxchain step --resume`
- `agentxchain run`

## Behavior

- Turn startup is split into explicit lifecycle states:
  - `assigned` — role reserved, no dispatch bundle finalized yet
  - `dispatched` — dispatch bundle finalized on disk, worker not attached yet
  - `starting` — worker subprocess attached, waiting for first output
  - `running` — first output or equivalent runtime proof observed
- A ghost turn is an active turn in `dispatched`, `starting`, `running`, or
  `retrying` where all of the following are true after
  `run_loop.startup_watchdog_ms`:
  - no turn-scoped staged result exists
  - no first-output proof exists on the turn or dispatch-progress file
  - the lifecycle age exceeds the startup threshold
- Empty placeholder turn-result files such as `{}` do **not** count as staged
  results. The local CLI adapter may pre-clear a prior result file before
  spawn; watchdog reconciliation must treat that placeholder as "no result yet,"
  not as proof of healthy execution.
- Default startup threshold is 30 seconds.
- `run_loop.startup_watchdog_ms` overrides the default.
- The active fix path is runtime-owned, not only lazy reconciliation:
  - `step` and `run` pass a startup watchdog into `dispatchLocalCli()`
  - the adapter kills silent subprocesses when the threshold expires
  - the caller transitions the retained turn to `failed_start` immediately
- Lazy reconciliation remains as a recovery backstop for already-persisted
  `dispatched` / `starting` turns surfaced via `status`, `resume`, and
  `step --resume`.
- Ghost turns transition from `running`/`retrying` to `failed_start`.
- Reconciliation emits `turn_start_failed`, blocks the run, and preserves the
  turn for explicit operator recovery via:
  - `agentxchain reissue-turn --turn <turn_id> --reason ghost`
- Budget reservations for ghost turns are released immediately on transition to
  `failed_start`.
- Ghost detection and stale-turn detection are distinct:
  - ghost: worker never spawned cleanly or never produced first output inside
    the startup window
  - stale: worker produced first output and later went silent past the slower
    threshold

### Signal choice: first-output proof vs `stdout.log`

- `stdout.log` remains operator-facing visibility, not the health oracle.
- For local CLI dispatch, the authoritative startup proof is:
  - successful worker attachment (`starting`)
  - then first output or staged result (`running`)
- Dispatch-progress is still used, but only after real spawn attachment.
  Pre-spawn progress files are banned because they create false evidence.
- Consequence:
  - missing `stdout.log` can correlate with a startup failure, but the real
    contract is "no first output / no staged result inside the startup window"
    rather than "log file missing"

## Error Cases

- Missing or malformed dispatch-progress files do not crash reconciliation; they
  count as absent startup proof.
- Empty or placeholder turn-result files (`{}` / blank content) do not suppress
  ghost or stale detection.
- Turns already transitioned away from `running`/`retrying` are ignored.
- Ghost detection must not double-report a turn that also qualifies as stale;
  ghost detection wins and stale detection is filtered for that turn.
- A subprocess that exits immediately with no output is a startup failure, not a
  stale turn.
- A deadline timeout still reports `timedOut`; the startup watchdog must not
  mask the normal turn deadline path.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js`
  - detects ghost turns in both `dispatched` and `starting` states
  - requires first-output proof, not just progress-file presence
  - transitions ghost turns to `failed_start`
  - releases budget reservations for ghost turns
  - surfaces ghost recovery via `status --json`
  - proves `step` fails fast for both:
    - subprocess exits immediately with no output
    - subprocess stays alive but never emits output
- `cli/test/beta-tester-scenarios/bug-47-stale-turn-watchdog.test.js`
  - proves the stale path is still reserved for turns that had dispatch-progress
    plus first-output proof and later went silent
- `cli/test/config-governed.test.js`
  - proves `config --set` rejects invalid `run_loop.startup_watchdog_ms` /
    `run_loop.stale_turn_threshold_ms`
  - proves `validate --json` fails closed on hand-edited invalid watchdog values
- `cli/test/governed-doctor-e2e.test.js`
  - proves `doctor --json` surfaces invalid watchdog values as a failing
    `config_valid` check instead of silently relying on runtime defaults
- `cli/test/local-cli-adapter.test.js`
  - preserves normal deadline timeout semantics even with the startup watchdog

## Open Questions

- Whether ghost-start failures should auto-reissue behind an explicit config
  flag once operators have confidence in the retained-turn diagnostics.
- Whether non-local runtimes should expose a richer "startup attached" signal
  than the current request/response proof.
