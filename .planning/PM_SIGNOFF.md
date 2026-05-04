# PM Signoff — M8: Hosted Runner — Execute Protocol Against Cloud Agent APIs

Approved: YES

**Run:** `run_0937d8f23ff72791`
**Phase:** planning
**Turn:** `turn_210b54fbb6a3ea55`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators who want to run governed turns against cloud agent APIs (Anthropic, OpenAI, Google) from a hosted HTTP server — without needing a local CLI session, repo clone, or long-running terminal process.

### Core Pain Point

The agentxchain protocol has three infrastructure layers ready:
1. **Protocol bridge** (`cli/src/lib/api/protocol-bridge.js`) — wraps runner-interface.js for HTTP consumption with typed errors and state-provider seams (delivered in run_8140752664578eb2, ROADMAP.md:94)
2. **API proxy adapter** (`cli/src/lib/adapters/api-proxy-adapter.js`) — dispatches turns to Anthropic, OpenAI, Google, and Ollama cloud APIs with retry, cost tracking, and error classification
3. **Run loop** (`cli/src/lib/run-loop.js`) — reusable governed execution engine explicitly designed for "CLI, CI, hosted, custom" runners

**But there is no HTTP server that composes these layers into a remotely-accessible hosted runner.** The OpenAPI spec from :94 defines the contract, the bridge proves composability, but no process actually serves HTTP requests, dispatches turns to cloud APIs, and manages execution leases. ROADMAP.md:95 closes this gap.

## Challenge to Previous Turn

### OBJ-PM-001: Planning artifacts describe control plane API design (run_8140752664578eb2, ROADMAP.md:94) — this run targets hosted runner implementation (ROADMAP.md:95) (severity: high)

All three planning artifacts were written for the previous run's scope:
- PM_SIGNOFF.md scoped OpenAPI spec + protocol bridge + schema tests
- SYSTEM_SPEC.md described 3 new files (openapi.yaml, protocol-bridge.js, schema tests)
- ROADMAP.md phases table showed control plane API design phases for `run_8140752664578eb2`

This run targets ROADMAP.md:95 — "Implement hosted runner that executes protocol against cloud agent APIs." All three artifacts rewritten from scratch.

### Core Workflow (this run)

1. **PM (this turn)** — Scope hosted runner implementation, define architecture, dev charter
2. **Dev** — Implement HTTP server, execution worker, job queue, `agentxchain serve` command, integration tests
3. **QA** — Verify end-to-end lifecycle: create run via API → worker dispatches to cloud API → turn result visible via API

### MVP Scope (this run)

**This run scopes ROADMAP.md:95 — "Implement hosted runner that executes protocol against cloud agent APIs."**

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Scope, architecture decisions, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec with file:line integration points
3. ROADMAP.md: Update phases table

**Dev deliverables:**
1. `cli/src/lib/api/hosted-runner.js` — HTTP server module implementing control plane API routes via the protocol bridge. Uses Node.js `node:http` (zero new dependencies). Routes map OpenAPI operations to bridge functions.
2. `cli/src/lib/api/execution-worker.js` — Execution worker module. Wraps run-loop + api_proxy adapter. Implements the execution plane lease model (claim, heartbeat, finalize). Emits structured execution events.
3. `cli/src/lib/api/job-queue.js` — In-memory FIFO job queue. Project-scoped dispatch queues, lease acquisition, heartbeat tracking, stale-lease expiry. Matches execution plane spec behavior rules 2-4.
4. `cli/src/commands/serve.js` — `agentxchain serve` CLI command. Starts the hosted runner HTTP server on configurable port (default 4100). Binds to configurable host (default 127.0.0.1 for safety). Accepts `--project` for explicit project root.
5. `cli/test/hosted-runner.test.js` — Integration tests. End-to-end lifecycle: create run → assign turn → worker dispatches to cloud API (mocked) → accept result → query via API. Plus job queue lease tests and error handling.

### Out of Scope

- Cloud persistence layer (state remains filesystem-based via state-provider seams)
- Multi-tenant organization/workspace management (single-project server for MVP)
- OAuth/JWT authentication provider (server accepts requests without auth for v1 — localhost-only default)
- Production deployment configuration (Dockerfile, systemd, cloud infrastructure)
- Dashboard UI (future ROADMAP.md:96)
- Webhook delivery implementation
- Customer-provided workers (execution plane spec rule 11: service-operated only for v1)
- Multi-region scheduling or failover
- Rate limiting implementation
- TLS/HTTPS (reverse proxy concern)
- Changes to existing protocol-bridge.js, runner-interface.js, api-proxy-adapter.js, or run-loop.js

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP | ROADMAP.md:95 scoped with planning artifacts |
| 2 | Unchecked roadmap item completed: Implement hosted runner that executes protocol against cloud agent APIs | HTTP server serves control plane API, execution worker dispatches to cloud APIs via api_proxy adapter, job queue manages leases |
| 3 | Evidence source: .planning/ROADMAP.md:95 | ROADMAP.md:95 checked off after QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| HTTP server adds new dependency | Low | Use `node:http` built-in — zero new npm dependencies |
| Execution worker re-implements run-loop logic | High | Worker composes run-loop directly (it's already designed for hosted use) — no reimplementation |
| Job queue semantics diverge from execution plane spec | Medium | Queue implementation is tested against spec behavior rules 2-4; lease timeouts match spec (30min local_cli, 10min api_proxy) |
| Localhost-only default is too restrictive for hosted use | Low | Configurable `--host` flag; default 127.0.0.1 is safe; production deployments override via flag |
| api_proxy adapter changes break hosted runner | Low | Hosted runner uses api_proxy as-is via run-loop dispatch callback — no adapter modifications |

### Design Decision: Node.js `node:http` with Zero New Dependencies (DEC-001)

The hosted runner uses Node.js built-in `node:http` module rather than Express, Fastify, or Hono because:
1. **Zero dependency addition** — package.json stays lean, no supply chain risk
2. **The protocol bridge does the heavy lifting** — HTTP server is a thin routing layer (path matching + JSON parsing + bridge call + error-to-status mapping)
3. **Consistent with existing patterns** — the dashboard bridge-server.js already uses bare `node:http`
4. **Adequate for MVP** — no middleware chains, no template rendering, no complex routing needed

### Design Decision: In-Process Execution Worker (DEC-002)

The execution worker runs in the same process as the HTTP server rather than a separate worker process because:
1. **Simplifies deployment** — single `agentxchain serve` process handles both API and execution
2. **State coherence** — worker and server share filesystem access without coordination
3. **Matches execution plane spec rule 12** — "keep execution narrow" for first implementation
4. **No IPC complexity** — worker lifecycle tied to server lifecycle
5. **Future split is trivial** — worker module is self-contained; extracting to a separate process later adds only a queue transport layer

### Design Decision: Run-Loop Composition for Turn Execution (DEC-003)

The execution worker dispatches turns by calling `runLoop()` with a dispatch callback that invokes the api_proxy adapter, rather than reimplementing dispatch logic:
1. **Protocol parity invariant** — run-loop IS the protocol engine; using it guarantees identical state transitions
2. **Reuse** — admission control, gate handling, parallel turns, timeout evaluation all come free
3. **Already designed for this** — run-loop.js header: "Any runner (CLI, CI, hosted, custom) composes this"
4. **package.json already exports it** — `"./run-loop": "./src/lib/run-loop.js"` in exports map

## Notes for Dev

**Your charter is 5 files: HTTP server + execution worker + job queue + serve command + integration tests.**

### 1. HTTP Server — `cli/src/lib/api/hosted-runner.js`

Route table maps OpenAPI operations to protocol bridge functions:

| Method | Path | Bridge Function | Notes |
|--------|------|----------------|-------|
| POST | `/v1/projects/:proj_id/runs` | `createRun` | Starts execution worker for new run |
| GET | `/v1/runs/:run_id` | `getRunState` | |
| GET | `/v1/projects/:proj_id/runs` | `listRuns` | |
| POST | `/v1/runs/:run_id/cancel` | `cancelRun` | |
| GET | `/v1/runs/:run_id/turns` | `getTurns` | |
| GET | `/v1/runs/:run_id/turns/:turn_id` | `getTurn` | |
| POST | `/v1/runs/:run_id/turns/:turn_id/accept` | `acceptTurnResult` | |
| POST | `/v1/runs/:run_id/turns/:turn_id/reject` | `rejectTurnResult` | |
| POST | `/v1/runs/:run_id/approve-transition` | `approveTransition` | |
| POST | `/v1/runs/:run_id/checkpoint` | `checkpointTurn` | |
| POST | `/v1/runs/:run_id/retry` | `retryTurn` | |
| GET | `/v1/runs/:run_id/events` | `getEvents` | |
| GET | `/v1/runs/:run_id/decisions` | `getDecisions` | |
| GET | `/v1/runs/:run_id/gates` | `getGates` | |
| GET | `/v1/runs/:run_id/export` | `exportRun` | |
| GET | `/health` | — | Returns `{ status: 'ok', version }` |

Key constraints:
- Use `node:http` — no Express/Fastify
- JSON request body parsing via `Buffer.concat` + `JSON.parse`
- Error-to-HTTP mapping: `NotFoundError`→404, `ValidationError`→422, `ProtocolError`→409, `ConflictError`→409, `AuthorizationError`→403
- Response format: `{ data: ... }` for success, `{ error: { code, message } }` for errors
- Expose `createHostedRunner(options)` → returns `{ server, start(), stop() }`

### 2. Execution Worker �� `cli/src/lib/api/execution-worker.js`

Wraps run-loop for hosted execution:

```javascript
export function createExecutionWorker(options) {
  // options: { root, config, queue, onEvent }
  // Returns: { start(), stop(), getStatus() }
}
```

Worker loop:
1. Poll job queue for claimable jobs
2. Acquire execution lease
3. Call `runLoop(root, config, callbacks)` with dispatch callback that invokes api_proxy adapter
4. On completion: finalize lease, emit `execution_completed` event
5. On failure: mark lease failed, emit `execution_interrupted` event

Heartbeat: worker updates lease `heartbeat_at` every 30s during execution (matches execution plane spec rule 3).

### 3. Job Queue — `cli/src/lib/api/job-queue.js`

In-memory queue matching execution plane spec:

```javascript
export function createJobQueue(options) {
  // Returns: { enqueue(job), claim(workerId), heartbeat(leaseId), finalize(leaseId, result), getStatus(), getJobs() }
}
```

Semantics:
- FIFO within project
- At most one active lease per job
- Default lease durations: 30min (local_cli), 10min (api_proxy)
- Stale lease detection: 2 missed heartbeat windows (60s without heartbeat)
- Stale leases transition to `needs_recovery` (not auto-retried — matches spec rule 4)
- Jobs carry: `{ job_id, project_id, run_id, turn_id, role, runtime_id, runtime_class, enqueued_at }`

### 4. CLI Command — `cli/src/commands/serve.js`

```
agentxchain serve [--port 4100] [--host 127.0.0.1] [--project <path>]
```

- Resolves project root (same as other commands)
- Loads normalized config
- Creates job queue, execution worker, and HTTP server
- Starts server, prints URL
- Graceful shutdown on SIGINT/SIGTERM

### 5. Integration Tests — `cli/test/hosted-runner.test.js`

| # | Test ID | Description |
|---|---------|-------------|
| T1 | AT-HR-001 | Server starts on configured port and responds to GET /health |
| T2 | AT-HR-002 | POST /v1/projects/:id/runs creates a run and returns state |
| T3 | AT-HR-003 | GET /v1/runs/:id returns run state after creation |
| T4 | AT-HR-004 | Execution worker picks up enqueued job and dispatches via api_proxy (mocked provider) |
| T5 | AT-HR-005 | Job queue enforces FIFO ordering and single-lease exclusivity |
| T6 | AT-HR-006 | Stale lease (no heartbeat for 60s) transitions to needs_recovery |
| T7 | AT-HR-007 | End-to-end: create run → worker executes turn (mocked API) → turn visible in GET /turns |
| T8 | AT-HR-008 | Error responses use standard error format: { error: { code, message } } |
| T9 | AT-HR-009 | Server shuts down gracefully on stop() without orphaned connections |
| T10 | AT-HR-010 | Cancel run via POST /cancel transitions state to blocked |

## Notes for QA

- Verify server starts and serves health endpoint
- Verify end-to-end run lifecycle via HTTP
- Verify job queue lease semantics match execution plane spec
- Run full test suite: `cd cli && npm test`
- After ship: verify ROADMAP.md:95 can be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP** — ROADMAP.md:95 scoped with planning artifacts; hosted runner composes protocol bridge + run-loop + api_proxy adapter into an HTTP-accessible runner
2. **Unchecked roadmap item completed: Implement hosted runner that executes protocol against cloud agent APIs** — HTTP server implements control plane API routes, execution worker dispatches turns via api_proxy to Anthropic/OpenAI/Google, job queue manages leases per execution plane spec
3. **Evidence source: .planning/ROADMAP.md:95** — ROADMAP.md:95 checked off after QA full suite verification
