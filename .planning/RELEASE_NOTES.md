# Release Notes — agentXchain.dev

## User Impact

**Pre-spawn command compatibility guard.** The local CLI adapter now blocks Claude commands using `--print` with `--output-format stream-json` that are missing `--verbose` before subprocess spawn. This prevents the known ghost-turn failure mode where Claude emits no parseable output, producing a `local_cli_command_incompatible` typed dispatch blocker with a clear recovery message instead of a silent startup failure.

**Startup heartbeat diagnostics.** Spawned local CLI subprocesses that are silent before first output now emit periodic `[adapter:diag] startup_heartbeat` diagnostics. Heartbeats are informational keepalives only — they do not count as startup proof and do not affect ghost-turn classification.

**Schema-backed watchdog configuration.** `startup_watchdog_ms` and `startup_heartbeat_ms` are now validated config knobs at both `run_loop.*` (global) and `runtimes.<id>.*` (per-runtime) levels, with runtime > global > default precedence. Invalid values are rejected at config validation time rather than silently falling back to defaults.

**Adapter timeout threading.** The `timeouts.per_turn_minutes` deadline is now reflected at the adapter dispatch boundary as well as the outer run-loop abort signal, ensuring consistent timeout enforcement.

## Verification Summary

- 42 local-cli-adapter tests: PASS (including 7 new ghost-hardening regression tests)
- 7 config schema tests: PASS
- 39 run-loop tests: PASS
- 31 timeout-evaluator tests: PASS
- 99 turn-result-validator tests: PASS
- 4 emission guard tests: PASS
- **Total: 222 in-scope tests, 0 failures**

## Upgrade Notes

No breaking changes for conformant configurations. Runtimes using `claude --print --output-format stream-json` must include `--verbose` in the command array; the adapter will now reject these at dispatch time instead of producing a ghost turn.

New optional config knobs:
- `run_loop.startup_watchdog_ms` (default: 180000)
- `run_loop.startup_heartbeat_ms` (default: 30000)
- `runtimes.<id>.startup_watchdog_ms` (per-runtime override)
- `runtimes.<id>.startup_heartbeat_ms` (per-runtime override)

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs.
