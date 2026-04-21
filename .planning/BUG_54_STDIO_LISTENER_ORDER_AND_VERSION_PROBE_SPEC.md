Status: Active — BUG-54 spawn-path hardening slice

# BUG-54 Stdio Listener Order And Version Probe Spec

## Purpose

Remove one remaining adapter-level race candidate from BUG-54 and capture the
Claude CLI version/path in tester repro artifacts.

The tester's raw BUG-54 JSON proved that the subprocess attached but produced
zero bytes on both streams until the watchdog killed it. A local run on
2026-04-21 produced stdout successfully with the same no-env Claude Max shape,
so the missing discriminator is the actual Claude binary and version in the
failing environment.

## Interface

- `cli/src/lib/adapters/local-cli-adapter.js`
- `cli/scripts/reproduce-bug-54.mjs`
- `cli/test/local-cli-adapter.test.js`
- `cli/test/reproduce-bug-54-script.test.js`

## Behavior

- The adapter must register stdout and stderr listeners before writing any
  prompt bytes to stdin.
- The repro harness must mirror that stdio setup order.
- The repro JSON header must include `command_probe`.
- For Claude runtimes, `command_probe` must run a bounded `claude --version`
  probe and capture:
  - `kind: "claude_version"`
  - exit status / signal
  - timeout or spawn error details
  - stdout / stderr text
- For non-Claude runtimes, `command_probe` must explicitly say it was skipped.
- The probe must never serialize auth token values.

## Error Cases

- If the Claude version probe times out, the repro script should still run the
  main attempts and record the timeout in `command_probe`.
- If the version probe spawn fails, the repro script should still run the main
  attempts and record the spawn error in `command_probe.error`.
- Non-Claude runtimes must not be forced through an arbitrary `--version`
  command because local_cli commands are user-defined.

## Acceptance Tests

- `cli/test/local-cli-adapter.test.js`
  - stdin transport still captures immediate stdout from a child process that
    writes after stdin end and exits without staging.
- `cli/test/reproduce-bug-54-script.test.js`
  - fake Claude runtime captures `command_probe.kind === "claude_version"` and
    its version stdout.
  - non-Claude runtime captures `command_probe.kind === "skipped"`.

## Open Questions

- Whether the next tester run should require the repro JSON to include a Claude
  version probe before BUG-54 is considered diagnosable enough for release.
