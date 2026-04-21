# BUG-54 Discriminator Runbook

Use this after running `cli/scripts/reproduce-bug-54.mjs`. Quote these fields,
not the whole JSON:

1. `command_probe.kind`, `status`, `stdout`, `stderr`, `timed_out`
2. `summary.spawn_attached`, `stdout_attached`, `watchdog_fires`
3. `summary.avg_first_stdout_ms`, `success_rate_first_stdout`
4. `summary.classification`
5. First failing attempt: `stdout_bytes`, `stderr_bytes`, `first_stdout_ms`,
   `first_stderr_ms`, `watchdog_fired`, `exit_signal`, full `stderr`
6. `env_snapshot.auth_env_present` booleans only
7. `resolved_command`, `resolved_args_redacted`, `prompt_transport`

## Reading Key

- `command_probe.kind: "claude_version"` with `status: 0` and a version in
  `stdout` identifies the actual Claude binary under test. Compare it to the
  healthy reference: `2.1.87 (Claude Code)`.
- Missing `command_probe` means the package/source is stale. Re-run from a
  build that includes Turn 118 or later.
- `exit_clean_with_stdout` for every attempt, `watchdog_fires: 0`, and non-zero
  `stdout_attached` means BUG-54 is not reproducing at spawn/attach.
- `watchdog_no_output` on attempt 1 with `stdout_bytes: 0`,
  `stderr_bytes: 0`, and `exit_signal: "SIGTERM"` means a deterministic silent
  block below AgentXchain dispatch. Re-run once with `--no-watchdog` or
  `--watchdog-ms 120000`.
- First attempts healthy, later attempts failing means resource accumulation is
  still plausible. Quote the attempt index where the first failure appears.
- `watchdog_stderr_only` or `exit_stderr_only` means stderr is the evidence.
  Quote full stderr; auth/stdin/EPIPE messages decide the next fix.
- High `avg_first_stdout_ms` with zero watchdog fires is slow startup, not
  failure. Tune watchdog only if later runs cross the threshold.
- Auth env booleans are context only. BUG-56 proved `all false` can still be a
  valid Claude Max/keychain setup.

Closure evidence for BUG-54 must show the tester's shipped package either
matches the healthy shape above or gives enough fields here to name a concrete
root cause.
