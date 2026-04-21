# BUG-54 Default Startup Watchdog Spec

## Purpose

Real Claude `local_cli` dispatches with realistic AgentXchain prompt bundles can take more than 30 seconds to produce the first stdout byte even when the subprocess is healthy. BUG-54 is therefore a false-kill threshold bug: the adapter and ghost detector terminate or retain healthy turns as `failed_start` before Claude can finish prompt processing.

## Interface

- Built-in default startup watchdog: `180000` milliseconds.
- Global override remains `run_loop.startup_watchdog_ms`.
- Runtime override remains `runtimes.<id>.startup_watchdog_ms` for `local_cli` runtimes.
- `dispatchLocalCli()` and `detectGhostTurns()` must resolve the same effective threshold.
- Operator docs and JSON schema must name the new 180-second default.

## Behavior

- If a `local_cli` runtime does not set `startup_watchdog_ms` and `run_loop.startup_watchdog_ms` is unset, the adapter waits 180 seconds for stdout startup proof or a staged result before killing the subprocess as a startup failure.
- Ghost-turn detection uses the same 180-second default before retaining a turn as `failed_start`.
- Explicit global and per-runtime overrides keep their existing precedence and validation behavior.
- Existing fast-failure tests may continue to set small explicit thresholds; this spec changes the default, not the override contract.

## Error Cases

- A subprocess that produces no stdout and no staged result before the effective threshold still fails with `no_subprocess_output`.
- A missing command still fails as `runtime_spawn_failed`.
- Stderr-only output still does not count as startup proof.
- Invalid override values remain config validation errors.

## Acceptance Tests

- `resolveStartupWatchdogMs({}, { type: "local_cli" })` returns `180000`.
- `detectGhostTurns()` does not flag a local CLI turn as ghost at 31 seconds when no startup override is set.
- A shim that emits first stdout after 31 seconds is not killed by the default startup watchdog.
- A silent shim with an explicit short override still fails with `no_subprocess_output`.
- JSON schema and CLI docs mention the 180-second default.

## Open Questions

- Whether future doctor output should sample startup latency percentiles from historical dispatch diagnostics. This is useful observability but not required to fix BUG-54's false-kill default.
