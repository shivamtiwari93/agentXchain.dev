# Implementation Notes — agentXchain.dev M1 Ghost Turn Hardening

## Challenge

The prior PM turn correctly identified the missing `--verbose` flag as the concrete root cause for the observed Claude `stream-json` ghost turns. I do not accept the broader conclusion that the adapter layer only needed additive watchdog hardening while leaving CLI compatibility unchecked. A known deterministic command-shape failure should be rejected before spawn, otherwise the system still depends on operator memory and post-failure watchdog recovery.

## Changes

- Added a local CLI compatibility guard that blocks Claude commands using `--print` plus `--output-format stream-json` without `--verbose` before subprocess spawn. The result is a typed `local_cli_command_incompatible` dispatch blocker instead of a ghost-style startup failure.
- Added startup heartbeat diagnostics for spawned local CLI subprocesses that are silent before first output. Heartbeats are written as `[adapter:diag] startup_heartbeat` and can update run progress as adapter keepalives, but they do not set `first_output_at` and do not count as governed startup proof.
- Added `startup_heartbeat_ms` as a schema-backed, validated knob at both `run_loop.startup_heartbeat_ms` and `runtimes.<id>.startup_heartbeat_ms`, with runtime > global > default precedence.
- Threaded explicit dispatch timeout inputs into the local CLI adapter so run-loop `timeouts.per_turn_minutes` deadlines are reflected at the adapter boundary as well as the outer run-loop abort signal.
- Added focused regression coverage for the missing-`--verbose` guard, startup heartbeat behavior, heartbeat precedence, stderr-only non-proof behavior, and existing per-turn timeout coverage.

## Verification

- `node --check cli/src/lib/adapters/local-cli-adapter.js` passed.
- `node --check cli/src/lib/dispatch-progress.js` passed.
- `node --check cli/src/commands/run.js` passed.
- `node --check cli/src/lib/normalized-config.js` passed.
- `node --test --test-timeout=60000 cli/test/local-cli-adapter.test.js` passed.
- `node --test --test-timeout=60000 cli/test/agentxchain-config-schema.test.js cli/test/timeout-evaluator.test.js cli/test/run-loop.test.js` passed.

## Notes

- I did not verify the acceptance target of zero ghost turns across 10 consecutive self-governed runs; that belongs in QA or a longer dogfood run.
- The existing turn timeout system is `timeouts.per_turn_minutes`; this turn verified it rather than introducing a second, conflicting timeout mechanism.
