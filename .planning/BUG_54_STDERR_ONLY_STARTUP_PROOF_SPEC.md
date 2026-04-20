Status: Active — BUG-54 startup-proof correction slice

# BUG-54 Stderr-Only Startup Proof Spec

## Purpose

Close the contradiction in BUG-54's startup classification contract:

- operator-facing BUG-54 language says stderr-only startups still belong to the
  `stdout_attach_failed` family because the subprocess spawned but never
  produced usable stdout-first-byte proof
- `dispatchLocalCli()` currently treats stderr as `first_output`, which
  downgrades stderr-only failures into generic "exited without staging" cases

This slice corrects that contradiction and preserves the stderr evidence needed
for diagnosis.

## Interface

- `cli/src/lib/adapters/local-cli-adapter.js`
- `cli/src/lib/dispatch-progress.js` (Turn 89 extension)
- `cli/src/lib/stale-turn-watchdog.js` (Turn 89 extension)
- `cli/src/lib/dispatch-streams.js` (Turn 90 extension)
- `cli/src/lib/governed-state.js` (Turn 90 extension)
- `cli/src/commands/run.js` (Turn 89 extension)
- `cli/src/commands/step.js` (Turn 90 extension)
- `cli/test/local-cli-adapter.test.js`
- `cli/test/dispatch-streams.test.js` (Turn 90 extension)
- `cli/test/dispatch-progress.test.js` (Turn 89 extension)
- `cli/test/governed-state.test.js` (Turn 90 extension)
- `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js` (Turn 89 extension)
- `cli/test/claim-reality-preflight.test.js`

## Behavior

- `dispatchLocalCli()` startup proof must only be satisfied by:
  - stdout output
  - a meaningful staged result appearing on disk
- Stderr output is still collected and logged, but it does NOT count as
  startup proof for BUG-54 classification.
- A subprocess that:
  - spawns successfully
  - emits stderr only
  - never emits stdout
  - never stages a turn result
  must return:
  - `startupFailure: true`
  - `startupFailureType: 'no_subprocess_output'`
  - no `onFirstOutput(...)` callback
- `process_exit` diagnostics must include a bounded `stderr_excerpt` when stderr
  was emitted, so operators can see the actual failure text without reading the
  whole log stream.
- Raw stderr lines remain in the adapter log. The structured excerpt is
  additive, not a replacement.
- **Turn 89 extension — watchdog / progress / run-command parity.** The same
  stderr-is-not-startup-proof contract applies to every layer that could
  otherwise downgrade a stderr-only start into "running":
  - `createDispatchProgressTracker().onOutput('stderr', ...)` MUST NOT set
    `state.first_output_at`. `stderr_lines` still increments for silence
    detection and diagnostics.
  - `hasStartupProof(turn, progress)` in `stale-turn-watchdog.js` MUST NOT
    treat `progress.stderr_lines > 0` as proof, and MUST NOT accept
    `turn.first_output_at` when `turn.first_output_stream === 'stderr'`.
    Only stdout-derived signals (`progress.output_lines > 0`,
    `progress.first_output_at`, or `turn.first_output_at` with a non-stderr
    stream) satisfy startup proof.
  - `run.js` `recordOutputActivity(stream, text)` MUST NOT call
    `ensureRunningState(stream)` for `stream === 'stderr'`. The adapter's
    own `onFirstOutput` callback is already stdout/staged_result-only
    (Turn 88), so the `running` lifecycle transition stays stdout-anchored
    across both dispatch paths.
- **Turn 90 extension — close the proof-stream vocabulary explicitly.**
  BUG-54 cannot rely on "anything except stderr" because the repo already uses
  three distinct proof streams across adapters:
  - `stdout` for local-cli subprocess output
  - `staged_result` for result-file proof without stdout
  - `request` for request/response adapters (`api_proxy`, `mcp`,
    `remote_agent`) that have no stdout concept
  The stream contract is now explicit:
  - only `stdout`, `staged_result`, and `request` may transition a turn into
    lifecycle `running`
  - only `stdout` may set dispatch-progress `first_output_at` / `output_lines`
  - unknown stream labels MUST NOT count as startup proof
  - legacy state with `first_output_at` and no `first_output_stream` remains
    valid proof for backward compatibility

## Error Cases

- A subprocess that emits stderr and exits before the watchdog must still be
  classified as a startup failure if no stdout/staged result proof exists.
- A subprocess that emits stderr, later emits stdout, then exits without
  staging is NOT a startup failure; stdout satisfied startup proof.
- Very large stderr output must be truncated in the structured diagnostic
  excerpt so diagnostics stay bounded.

## Acceptance Tests

- `cli/test/local-cli-adapter.test.js`
  - stderr-only subprocess returns `startupFailureType: 'no_subprocess_output'`
  - stderr-only subprocess does not fire `onFirstOutput`
  - `process_exit` diagnostic includes `stderr_excerpt`
- `cli/test/claim-reality-preflight.test.js`
  - packed `local-cli-adapter.js` preserves the same stderr-only startup
    failure behavior at the tarball boundary
- `cli/test/dispatch-progress.test.js` (Turn 89)
  - `tracker.onOutput('stderr', ...)` leaves `first_output_at === null` and
    `output_lines === 0`; a subsequent `onOutput('stdout', 1)` flips
    `first_output_at` to a timestamp.
- `cli/test/beta-tester-scenarios/bug-51-fast-startup-watchdog.test.js` (Turn 89)
  - A starting turn with `progress.stderr_lines > 0` but
    `output_lines === 0` and `first_output_at === null` is still reported as
    a ghost with `failure_type: 'stdout_attach_failed'`.
  - A starting turn whose state carries `turn.first_output_at` with
    `first_output_stream === 'stderr'` is still reported as a ghost with
    `failure_type: 'stdout_attach_failed'`.
- `cli/test/dispatch-streams.test.js` (Turn 90)
  - only `stdout`, `staged_result`, and `request` are accepted as lifecycle
    proof streams
  - unknown stream labels are rejected as startup proof
- `cli/test/dispatch-progress.test.js` (Turn 90)
  - `tracker.onOutput('mcp', ...)` or any other unknown stream label leaves
    `first_output_at === null`, `output_lines === 0`, and `stderr_lines === 0`
- `cli/test/governed-state.test.js` (Turn 90)
  - transitioning a turn to `running` with `stream: 'request'` persists
    `first_output_stream: 'request'`
  - transitioning a turn to `running` with an unknown stream does not persist
    `first_output_at` / `first_output_stream`

## Open Questions

- Whether a future BUG-54 slice should persist structured startup diagnostics as
  JSON alongside `stdout.log`, instead of relying on log-line parsing.
- ~~Whether the stale-turn watchdog should eventually distinguish stdout-proof and
  stderr-only progress explicitly, or whether adapter-time startup enforcement
  is sufficient.~~ **Resolved Turn 89 (`DEC-BUG54-WATCHDOG-STDERR-PARITY-001`):**
  adapter-time enforcement alone is not sufficient, because dispatch-progress
  tracking, the fast-startup watchdog, and `run.js` lifecycle promotion each
  had independent stderr-treated-as-proof paths. All three now enforce the
  same stdout-only startup-proof contract.
