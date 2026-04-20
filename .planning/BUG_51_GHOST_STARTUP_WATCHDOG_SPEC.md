Status: Shipped — implementation in v2.146.0; remains open pending tester verification per discipline rule #12

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
- `agentxchain status`
- `agentxchain status --json`
- `agentxchain resume`
- `agentxchain step --resume`
- `cli/src/lib/recent-event-summary.js`

## Behavior

- A ghost turn is an active turn with status `running` or `retrying` where all
  of the following are true:
  - `started_at` is older than `run_loop.startup_watchdog_ms`
  - no turn-scoped dispatch-progress file exists
  - no turn-scoped staged result exists
  - no turn-scoped durable event exists after dispatch other than the initial
    dispatch event
- Default startup threshold is 30 seconds.
- `run_loop.startup_watchdog_ms` overrides the default.
- Ghost detection runs lazily on the same CLI entry points as stale-turn
  reconciliation:
  - `status`
  - `resume`
  - `step --resume`
- Ghost turns transition from `running`/`retrying` to `failed_start`.
- Reconciliation emits `turn_start_failed`, blocks the run, and preserves the
  turn for explicit operator recovery via:
  - `agentxchain reissue-turn --turn <turn_id> --reason ghost`
- Budget reservations for ghost turns are released immediately on transition to
  `failed_start`.
- Ghost detection and stale-turn detection are distinct:
  - ghost: subprocess/output channel never attached
  - stale: subprocess attached, then went silent past the slower threshold

### Signal choice: dispatch-progress vs `stdout.log`

- The startup watchdog uses turn-scoped dispatch-progress as the primary signal,
  not `stdout.log` file existence.
- Rationale:
  - dispatch-progress is framework-authored and turn-scoped, so its presence is
    a stable cross-runtime proof that the subprocess/output path attached
  - `stdout.log` is adapter-authored operator visibility output and can be
    best-effort without invalidating the underlying turn
  - this preserves the tester-required "missing logfile / no first-byte /
    no heartbeat" intent without coupling health detection to adapter-specific
    logging details
- Consequence:
  - missing `stdout.log` may correlate with a ghost turn, but the authoritative
    health signal for BUG-51 is missing dispatch-progress plus the absence of
    staged results and durable turn activity

## Error Cases

- Missing or malformed dispatch-progress files do not crash reconciliation; they
  count as absent evidence.
- Turns already transitioned away from `running`/`retrying` are ignored.
- Ghost detection must not double-report a turn that also qualifies as stale;
  ghost detection wins and stale detection is filtered for that turn.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js`
  - detects ghost turns after the 30-second threshold
  - does not fire within the threshold
  - does not fire when dispatch-progress exists
  - transitions ghost turns to `failed_start`
  - releases budget reservations for ghost turns
  - emits `turn_start_failed`
  - surfaces ghost recovery via `status --json`, `resume`, and `step --resume`
  - respects `run_loop.startup_watchdog_ms`
  - preserves BUG-47 stale detection for turns with dispatch-progress
- `cli/test/beta-tester-scenarios/bug-47-stale-turn-watchdog.test.js`
  - proves the stale path is still reserved for turns that had dispatch-progress
    and later went silent

## Open Questions

- Whether future runtimes need an explicit worker-heartbeat signal beyond
  dispatch-progress for startup confirmation.
- Whether operator-observable startup failures should later split into narrower
  event types such as `stdout_attach_failed` or `runtime_spawn_failed` once the
  runtime contracts can distinguish them reliably.
