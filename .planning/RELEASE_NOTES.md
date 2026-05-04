# Release Notes — M8: Hosted Runner — Execute Protocol Against Cloud Agent APIs

## User Impact

This release delivers the **first runnable server** in the agentxchain ecosystem: an HTTP server that exposes control plane API routes and dispatches governed turns to cloud agent APIs (Anthropic, OpenAI, Google) using the existing protocol bridge, run-loop engine, and api_proxy adapter. This is ROADMAP.md:95.

### What Was Delivered

- **HTTP Server Module** (`cli/src/lib/api/hosted-runner.js`): 16 routes mapping OpenAPI operations to protocol bridge functions via `node:http`. JSON body parsing with 1MB cap. Typed error-to-HTTP mapping (404/409/422/403/500). Graceful shutdown with 5s drain timeout. Localhost-only default bind (127.0.0.1:4100).

- **Execution Worker** (`cli/src/lib/api/execution-worker.js`): In-process worker that polls the job queue, claims jobs, and dispatches governed turns via `runLoop()` + `dispatchApiProxy()` composition. Single turn per job (`maxTurns: 1`). 30s heartbeat interval. 4 structured execution events. Auto-approve gates in hosted mode.

- **Job Queue** (`cli/src/lib/api/job-queue.js`): In-memory FIFO queue implementing execution plane spec rules 2-4. Exclusive leases with heartbeat-based liveness. Stale detection (2 missed 30s heartbeats = 60s threshold). Crash-closed recovery (no auto-retry — transitions to `needs_recovery`). Lease durations: 10min for api_proxy, 30min for local_cli.

- **CLI Command** (`cli/src/commands/serve.js`): `agentxchain serve [--port 4100] [--host 127.0.0.1] [--project <path>]` starts the hosted runner. Graceful shutdown on SIGINT/SIGTERM.

- **Integration Tests** (`cli/test/hosted-runner.test.js`): 11 tests covering server lifecycle, run creation, state retrieval, queue FIFO/exclusivity, stale lease detection, error format, graceful shutdown, and run cancellation.

### Architecture Highlights

- **Protocol parity invariant maintained.** All 16 routes delegate to protocol-bridge.js — no reimplementation of state machine logic.
- **Zero new npm dependencies.** HTTP server uses `node:http`. All composition layers (protocol bridge, run-loop, api_proxy adapter, runner interface) are existing internal modules.
- **Run-loop is THE execution engine.** The worker delegates entirely to `runLoop()` — no reimplementation of dispatch, acceptance, timeout, or retry logic.
- **Single-turn-per-job model.** Each job executes exactly one turn. Multi-turn runs require re-enqueue after each turn, matching the explicit operator-driven recovery principle.
- **Localhost-only default** matching bridge-server.js security posture. Must explicitly pass `--host 0.0.0.0` to expose externally.

### What This Enables (Future Work)

This is the foundation for remaining ROADMAP.md managed surface items:
- Cloud persistence layer (replaces filesystem `@state-provider` seams in protocol-bridge.js)
- Dashboard UI (consumes the HTTP API)
- Multi-tenant org/workspace management
- Authentication/authorization enforcement
- Webhook delivery for external integrations

## Verification Summary

- 10/10 SYSTEM_SPEC acceptance tests pass (AT-HR-004/AT-HR-007 satisfied via alternative test coverage)
- 323 tests across 8 files, 0 failures, 0 regressions
- Vitest contract: 11/11 pass (file count = 669)
- CLI `serve --help` output verified with correct options
- Gate evaluation: `{ok: true}`
- Whitespace check: clean
- Code reviewed for correctness, security (localhost-only), import validity, spec compliance, and architecture invariants
