Status: Active — diagnostic logging slice for BUG-54

# BUG-54 Local CLI Startup Diagnostics Spec

## Purpose

Add explicit startup diagnostics to the `local_cli` dispatch path so repeated
`runtime_spawn_failed` / `stdout_attach_failed` runs can be debugged from the
actual turn bundle instead of inference from missing output.

This is the first BUG-54 slice only. It does not claim to fix the reliability
defect. It makes the failure observable enough to reproduce and distinguish:

- bad spawn context
- bad runtime command/cwd
- stdin delivery errors such as `EPIPE`
- spawn-success / no-first-byte races
- repeated stderr-only exits

## Interface

- `cli/src/lib/adapters/local-cli-adapter.js`
  - `dispatchLocalCli(...)`
  - `saveDispatchLogs(...)`
- `cli/test/local-cli-adapter.test.js`
- `cli/test/claim-reality-preflight.test.js`

## Behavior

- Every `local_cli` dispatch must append structured diagnostic lines to the
  turn's adapter log stream before the subprocess is started.
- Diagnostic logging must include:
  - resolved command
  - resolved args with prompt payload redacted
  - cwd
  - prompt transport
  - stdin byte count
  - selected spawn-context env keys needed for debugging (`PATH`, `HOME`,
    `PWD`, `SHELL`, `TMPDIR`, `AGENTXCHAIN_TURN_ID`)
- When the child reports `spawn`, diagnostics must record:
  - pid
  - spawn timestamp
- When first output arrives, diagnostics must record:
  - first-byte timestamp
  - stream (`stdout`, `stderr`, or `staged_result`)
- When stdin delivery fails, diagnostics must record:
  - error code/message
  - failure timestamp
- When the process exits or errors, diagnostics must record:
  - exit code
  - exit signal
  - stdout/stderr byte counts
  - first-byte timestamp if any
  - startup-failure classification if known
- Existing stderr capture remains intact. Structured diagnostics are additive,
  not a replacement for raw stderr lines.
- Diagnostics must fail closed on secrets:
  - do not dump the whole environment
  - do not write the full prompt into args diagnostics

## Error Cases

- Nonexistent binaries still classify as `runtime_spawn_failed`, but the log
  must now show the resolved spawn context that failed.
- Spawn-but-silent subprocesses still classify as `no_subprocess_output`
  inside the adapter, but the log must now show spawn proof plus exit summary.
- Stdin `EPIPE` / broken-pipe paths must be logged instead of swallowed.
- Missing optional env keys must serialize as absent, not as errors.

## Acceptance Tests

- `cli/test/local-cli-adapter.test.js`
  - failing nonexistent binary emits `spawn_prepare` + `spawn_error`
    diagnostics
  - spawn-but-silent subprocess emits `spawn_attached` + `process_exit`
    diagnostics
  - stdin transport records a positive `stdin_bytes` value
- `cli/test/claim-reality-preflight.test.js`
  - packaged `local-cli-adapter.js` proves the diagnostics survive packing for
    both a nonexistent binary and a spawn-but-silent subprocess

## Open Questions

- Whether BUG-54 should also persist a machine-readable
  `startup-diagnostics.json` beside `stdout.log` once the reliability fix is
  understood.
- Whether repeated-startup telemetry should emit a new run event type or stay
  log-only to avoid event-surface churn during the debugging phase.
