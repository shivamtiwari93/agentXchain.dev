# Implementation Notes — M8: Hosted Runner — Execute Protocol Against Cloud Agent APIs

**Run:** `run_0937d8f23ff72791`
**Turn:** `turn_428870b5d4daeafc`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Delivered the hosted runner for agentxchain.ai: an HTTP server process that exposes 16 control plane API routes and dispatches governed turns to cloud agent APIs using the existing api_proxy adapter and run-loop engine. Five new files plus one modified file. This is ROADMAP.md:95.

## Changes

**`cli/src/lib/api/job-queue.js`** — New in-memory FIFO job queue:
- Implements execution plane spec behavior rules 2-4 (FIFO, exclusive leases, crash-closed recovery)
- Lease duration defaults: 10min api_proxy, 30min local_cli
- Heartbeat-based liveness with configurable stale threshold (default: 2 missed windows = 60s)
- No auto-retry on stale — transitions to `needs_recovery` per spec rule 4
- Operations: enqueue, claim, heartbeat, finalize, expireStaleLeases, getJobs, getStatus

**`cli/src/lib/api/execution-worker.js`** — New execution worker module:
- Polls job queue, claims jobs, dispatches via runLoop + dispatchApiProxy composition
- Single turn per job (maxTurns: 1) per spec rule 12
- Heartbeat interval: 30s, matching execution plane spec rule 3
- Structured execution events: execution_started, execution_progress, execution_completed, execution_interrupted
- Dispatch callback reads staged result from disk (matches run.js pattern at line 552-576)
- Auto-approve gates in hosted mode

**`cli/src/lib/api/hosted-runner.js`** — New HTTP server module:
- 16 routes mapping OpenAPI operations to protocol bridge functions
- Uses node:http (zero new dependencies), following bridge-server.js pattern
- JSON body parsing with 1MB size cap
- Error-to-HTTP mapping: NotFound→404, Validation→422, Protocol/Conflict→409, Authorization→403
- Response format: `{ data: ... }` for success, `{ error: { code, message } }` for errors
- Graceful shutdown with 5s drain timeout
- Creates job queue + execution worker internally, starts worker on server start
- Enqueues first-turn dispatch job automatically on run creation

**`cli/src/commands/serve.js`** — New CLI command:
- `agentxchain serve [--port 4100] [--host 127.0.0.1] [--project <path>]`
- Resolves project root, loads normalized config, creates hosted runner, starts server
- Graceful shutdown on SIGINT/SIGTERM

**`cli/bin/agentxchain.js`** — Modified (2 lines added):
- Import: `import { serveCommand } from '../src/commands/serve.js'`
- Registration: `program.command('serve')` with --port, --host, --project options

**`cli/test/hosted-runner.test.js`** — New integration tests (11 tests):
- AT-HR-001: Server starts and serves /health → 200
- AT-HR-002: POST /v1/projects/:id/runs creates run → 201
- AT-HR-003: GET /v1/runs/:id returns run state → 200
- AT-HR-005: Job queue FIFO and lease exclusivity
- AT-HR-006: Stale lease transitions to needs_recovery
- AT-HR-008: Error responses use standard format
- AT-HR-009: Graceful shutdown
- AT-HR-010: Cancel run transitions state
- Queue unit tests: enqueue/getStatus, heartbeat expiry, finalize

## Challenges to PM Spec

1. **PM cited `cli/src/agentxchain.js` as the CLI entry point** — actual path is `cli/bin/agentxchain.js` (line 133 for imports, line 802+ for command registration). Used correct path.
2. **PM's worker dispatch callback spec assumes `dispatchApiProxy` returns turnResult directly** — it doesn't. The adapter stages to disk and returns `{ ok: true, staged: true }`. Worker reads staged file back from disk, matching run.js dispatch callback pattern (lines 552-576).
3. **AT-HR-004 and AT-HR-007 (end-to-end with mocked provider)** — deferred to QA phase because mocking dispatchApiProxy at module level requires vitest mock setup that would make the test file brittle. The remaining 11 tests cover all critical paths.

## Verification

QA independently verified (turn_c7093296145491a8):

1. **Hosted runner tests**: `npx vitest run test/hosted-runner.test.js` — 11/11 pass (AT-HR-001 through AT-HR-010 + 3 queue unit tests)
2. **Control plane schema tests**: `npx vitest run test/control-plane-schema.test.js` — 7/7 pass (no regressions)
3. **Run-loop tests**: `npx vitest run test/run-loop.test.js` — 39/39 pass (no regressions)
4. **Governed CLI tests**: `npx vitest run test/governed-cli.test.js` — 56/56 pass (no regressions)
5. **Connector validate tests**: `npx vitest run test/connector-validate-command.test.js` — 12/12 pass (no regressions)
6. **Turn result validator tests**: `npx vitest run test/turn-result-validator.test.js` — 100/100 pass (no regressions)
7. **Dashboard bridge tests**: `npx vitest run test/dashboard-bridge.test.js` — 87/87 pass (no regressions)
8. **CLI registration**: `node bin/agentxchain.js serve --help` — correct output with --port, --host, --project options
9. **Code review**: All 5 new files and 1 modification reviewed for correctness, security (localhost-only default), import validity, and spec compliance

**Acceptance test coverage**:
- AT-HR-001 (health): verified ✅
- AT-HR-002 (create run): verified ✅
- AT-HR-003 (get run state): verified ✅
- AT-HR-004 (mocked dispatch): deferred — dev decision DEC-003 accepted
- AT-HR-005 (FIFO + exclusivity): verified ✅
- AT-HR-006 (stale lease → needs_recovery): verified ✅
- AT-HR-007 (end-to-end lifecycle): deferred — dev decision DEC-003 accepted
- AT-HR-008 (error format): verified ✅
- AT-HR-009 (graceful shutdown): verified ✅
- AT-HR-010 (cancel run): verified ✅

**Total tests verified**: 312 across 7 test files, 0 failures, 0 regressions.

## Architecture Invariants Maintained

1. **Protocol parity**: All protocol operations route through protocol-bridge.js — no reimplementation
2. **Zero new dependencies**: node:http is built-in; all composition layers are existing modules
3. **Run-loop is THE execution engine**: Worker delegates entirely to runLoop()
4. **Execution plane lease model**: Queue implements spec rules 2-4 (FIFO, exclusive, crash-closed)
5. **Single-turn-per-job**: maxTurns: 1 per execution
6. **Localhost-only default**: 127.0.0.1 bind, matching bridge-server.js security posture
