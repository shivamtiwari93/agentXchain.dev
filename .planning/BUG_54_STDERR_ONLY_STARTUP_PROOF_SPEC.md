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
- `cli/test/local-cli-adapter.test.js`
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

## Open Questions

- Whether a future BUG-54 slice should persist structured startup diagnostics as
  JSON alongside `stdout.log`, instead of relying on log-line parsing.
- Whether the stale-turn watchdog should eventually distinguish stdout-proof and
  stderr-only progress explicitly, or whether adapter-time startup enforcement
  is sufficient.
