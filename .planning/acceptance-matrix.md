# Acceptance Matrix — agentXchain.dev

**Run:** run_984f0f8c07a30a5c
**Scope:** M1 Ghost Turn Hardening — pre-spawn command compatibility, startup heartbeat diagnostics, config validation, regression tests

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| AC-001 | Pre-spawn Claude command compatibility guard | `claude --print --output-format stream-json` without `--verbose` is blocked before subprocess spawn with typed `local_cli_command_incompatible` blocker | Test "blocks Claude stream-json --print commands that are missing --verbose before spawning" passes; `validateLocalCliCommandCompatibility` unit test passes | 2026-05-01 | PASS |
| AC-002 | Startup heartbeat diagnostics are non-proof keepalives | Heartbeats emit `[adapter:diag] startup_heartbeat` during pre-output silence but do NOT set `first_output_at` or count as governed startup proof | Test "emits startup heartbeat diagnostics during pre-output subprocess silence without marking startup proof" passes | 2026-05-01 | PASS |
| AC-003 | Heartbeat interval precedence: runtime > global > default | `resolveStartupHeartbeatMs` returns runtime-specific override first, then global `run_loop.startup_heartbeat_ms`, then DEFAULT_STARTUP_HEARTBEAT_MS | Test "resolves startup heartbeat interval with runtime over global over default precedence" passes | 2026-05-01 | PASS |
| AC-004 | Schema-backed config knobs for startup_watchdog_ms and startup_heartbeat_ms | Both knobs are declared in `agentxchain-config.schema.json` with descriptions and validated as positive integers by `normalized-config.js` | Schema test AT-CONFIG-SCHEMA-007 "publishes run_loop watchdog knobs as schema-backed operator contract" passes; syntax checks pass | 2026-05-01 | PASS |
| AC-005 | Stderr-only startup classified as no_subprocess_output | Subprocess that produces stderr but no stdout is classified with `failure_type: "no_subprocess_output"` and stderr excerpt preserved | Test "treats stderr-only startup as no_subprocess_output and preserves a stderr excerpt" passes | 2026-05-01 | PASS |
| AC-006 | Per-turn timeout budget threaded to adapter | `timeouts.per_turn_minutes` deadline is reflected at both the run-loop abort signal and the adapter dispatch boundary | Timeout evaluator suite (31 tests) and run-loop in-flight dispatch timeout (3 tests) pass | 2026-05-01 | PASS |
| AC-007 | No regressions in pre-existing test suites | All pre-existing validator, scenario, emission guard, and run-loop tests continue to pass | 99 validator + 4 emission guard + 39 run-loop + 31 timeout + 7 schema = 180 adjacent tests pass | 2026-05-01 | PASS |
| AC-008 | No reserved path modifications | Dev changes do not touch .agentxchain/state.json, history.jsonl, decision-ledger.jsonl, or lock.json source code | git diff --name-only confirms only IMPLEMENTATION_NOTES.md + 5 source files + 1 test file changed | 2026-05-01 | PASS |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure and handoff format from prior runs; predates this run entirely | Not a regression — pre-existing state issue; 5/8 AGENT-TALK tests pass |
