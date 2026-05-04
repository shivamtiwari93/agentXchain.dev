# System Spec — M8: Hosted Runner — Execute Protocol Against Cloud Agent APIs

**Run:** `run_0937d8f23ff72791`
**Baseline:** git:ed95fd5fd (latest checkpoint)
**Package version:** `agentxchain@2.155.73`

## Purpose

Implement the hosted runner for agentxchain.ai: an HTTP server process that exposes control plane API routes (from the OpenAPI spec delivered in run_8140752664578eb2) and dispatches governed turns to cloud agent APIs (Anthropic, OpenAI, Google) using the existing api_proxy adapter and run-loop engine.

This is ROADMAP.md:95 — the first runnable server in the agentxchain ecosystem. It composes three existing layers:
1. Protocol bridge (`cli/src/lib/api/protocol-bridge.js:141-476`) — HTTP-free wrappers around runner-interface.js
2. Run loop (`cli/src/lib/run-loop.js:72`) — reusable governed execution engine with `callbacks.dispatch` seam
3. API proxy adapter (`cli/src/lib/adapters/api-proxy-adapter.js:788`) — `dispatchApiProxy()` sends turns to cloud APIs

---

## 1. Architecture Overview

### 1.1 Existing Infrastructure (Referenced)

| Layer | File | LOC | Key Exports Used by Hosted Runner |
|-------|------|-----|-----------------------------------|
| Protocol bridge | `cli/src/lib/api/protocol-bridge.js` | 476 | `createRun`, `getRunState`, `listRuns`, `cancelRun`, `getTurns`, `getTurn`, `acceptTurnResult`, `rejectTurnResult`, `approveTransition`, `checkpointTurn`, `retryTurn`, `getEvents`, `getDecisions`, `getGates`, `exportRun` + 5 error classes |
| Run loop | `cli/src/lib/run-loop.js` | 877 | `runLoop(root, config, callbacks, options)` |
| API proxy adapter | `cli/src/lib/adapters/api-proxy-adapter.js` | 1389 | `dispatchApiProxy(root, state, config, options)` |
| Runner interface | `cli/src/lib/runner-interface.js` | 64 | 18 protocol primitives (v0.2) |
| Dashboard bridge | `cli/src/lib/dashboard/bridge-server.js` | 633 | Pattern reference for `node:http` server structure |
| Config | `cli/src/lib/config.js` | 184 | `loadProjectContext`, `loadProjectState` |
| Normalized config | `cli/src/lib/normalized-config.js` | 1573 | `loadNormalizedConfig` |
| OpenAPI spec | `api/v1/control-plane.openapi.yaml` | — | Route contract (29 operations) |

### 1.2 Frozen Architecture Specs

| Spec | Key Rules Applied Here |
|------|----------------------|
| `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md` | Protocol parity invariant, shared state machine semantics |
| `AGENTXCHAIN_AI_EXECUTION_PLANE_SPEC.md` | Lease model (30min/10min), heartbeat (30s), FIFO queues, structured events, crash recovery fails closed, v1 is service-operated only |
| `AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md` | Endpoint paths, RBAC model (deferred for MVP) |

### 1.3 Package.json Exports Already Proven

The `cli/package.json:11-17` exports map already publishes the composable SDK:
```json
"./run-loop": "./src/lib/run-loop.js"
"./runner-interface": "./src/lib/runner-interface.js"
"./adapter-interface": "./src/lib/adapter-interface.js"
```

The hosted runner is the first internal consumer of this SDK surface.

---

## 2. Deliverables

### 2.1 HTTP Server Module — `cli/src/lib/api/hosted-runner.js`

**New file.** Implements control plane API routes using protocol bridge + `node:http`.

#### 2.1.1 Module API

```javascript
/**
 * Create a hosted runner instance.
 * @param {object} options
 * @param {string} options.root - project root directory
 * @param {object} options.config - normalized config
 * @param {number} [options.port=4100] - server port
 * @param {string} [options.host='127.0.0.1'] - bind address
 * @returns {{ server: http.Server, start(): Promise<void>, stop(): Promise<void>, worker: ExecutionWorker, queue: JobQueue }}
 */
export function createHostedRunner(options)
```

#### 2.1.2 Route Table

Routes are a static array matched against `req.url` with simple path parameter extraction (same pattern as `bridge-server.js:336`).

| Method | Path Pattern | Bridge Function | HTTP Status (success) |
|--------|-------------|----------------|----------------------|
| GET | `/health` | (inline) | 200 |
| POST | `/v1/projects/:proj_id/runs` | `createRun` | 201 |
| GET | `/v1/projects/:proj_id/runs` | `listRuns` | 200 |
| GET | `/v1/runs/:run_id` | `getRunState` | 200 |
| POST | `/v1/runs/:run_id/cancel` | `cancelRun` | 200 |
| GET | `/v1/runs/:run_id/turns` | `getTurns` | 200 |
| GET | `/v1/runs/:run_id/turns/:turn_id` | `getTurn` | 200 |
| POST | `/v1/runs/:run_id/turns/:turn_id/accept` | `acceptTurnResult` | 200 |
| POST | `/v1/runs/:run_id/turns/:turn_id/reject` | `rejectTurnResult` | 200 |
| POST | `/v1/runs/:run_id/approve-transition` | `approveTransition` | 200 |
| POST | `/v1/runs/:run_id/checkpoint` | `checkpointTurn` | 200 |
| POST | `/v1/runs/:run_id/retry` | `retryTurn` | 200 |
| GET | `/v1/runs/:run_id/events` | `getEvents` | 200 |
| GET | `/v1/runs/:run_id/decisions` | `getDecisions` | 200 |
| GET | `/v1/runs/:run_id/gates` | `getGates` | 200 |
| GET | `/v1/runs/:run_id/export` | `exportRun` | 200 |

#### 2.1.3 Error Mapping

```javascript
function mapErrorToResponse(err) {
  if (err instanceof NotFoundError)      return { status: 404, body: { error: { code: err.code, message: err.message } } };
  if (err instanceof ValidationError)    return { status: 422, body: { error: { code: err.code, message: err.message } } };
  if (err instanceof ProtocolError)      return { status: 409, body: { error: { code: err.code, message: err.message } } };
  if (err instanceof ConflictError)      return { status: 409, body: { error: { code: err.code, message: err.message } } };
  if (err instanceof AuthorizationError) return { status: 403, body: { error: { code: err.code, message: err.message } } };
  return { status: 500, body: { error: { code: 'internal_error', message: 'Internal server error' } } };
}
```

#### 2.1.4 Request Body Parsing

Collect chunks into a Buffer, decode UTF-8, `JSON.parse`. Cap body size at 1MB. Return 400 on parse failure.

#### 2.1.5 Side Effect on Run Creation

When `POST /v1/projects/:proj_id/runs` succeeds, the server enqueues a dispatch job into the job queue so the execution worker picks up the first turn automatically.

#### 2.1.6 Graceful Shutdown

`stop()` calls `server.close()`, waits for in-flight requests to drain (5s timeout), then stops the execution worker.

---

### 2.2 Execution Worker Module — `cli/src/lib/api/execution-worker.js`

**New file.** In-process worker that polls the job queue and executes governed turns.

#### 2.2.1 Module API

```javascript
/**
 * Create an execution worker.
 * @param {object} options
 * @param {string} options.root - project root directory
 * @param {object} options.config - normalized config
 * @param {JobQueue} options.queue - job queue instance
 * @param {function} [options.onEvent] - structured event callback
 * @param {string} [options.workerId] - worker identifier (default: generated)
 * @param {number} [options.pollIntervalMs=2000] - queue poll interval
 * @returns {{ start(): void, stop(): void, getStatus(): WorkerStatus }}
 */
export function createExecutionWorker(options)
```

#### 2.2.2 Execution Loop

```
while (running) {
  1. Poll queue for claimable job
  2. If none: sleep pollIntervalMs, continue
  3. Claim execution lease
  4. Start heartbeat interval (30s)
  5. Call runLoop(root, config, {
       selectRole: (state) => job.role,
       dispatch: (context) => dispatchApiProxy(root, context.state, config, {
         turnId: context.turn.turn_id,
         signal: abortController.signal,
       }),
       approveGate: () => true,  // auto-approve for hosted
       onEvent: (event) => emit execution event
     }, { maxTurns: 1 })
  6. Clear heartbeat interval
  7. Finalize lease (pass/fail based on runLoop result)
  8. Emit execution_completed or execution_interrupted
}
```

#### 2.2.3 Run-Loop Integration Points

| Run-Loop Callback | Implementation | Reference |
|-------------------|---------------|-----------|
| `selectRole(state, config)` | Returns `job.role` from the enqueued job | `run-loop.js:224` |
| `dispatch(context)` | Calls `dispatchApiProxy(root, context.state, config, opts)` | `run-loop.js:581`, `api-proxy-adapter.js:788` |
| `approveGate(type, state)` | Returns `true` (auto-approve in hosted mode) | `run-loop.js:697` |
| `onEvent(event)` | Forwards to `options.onEvent` + emits structured execution event | `run-loop.js:78` |

#### 2.2.4 Structured Execution Events

Per execution plane spec behavior rule 6, the worker emits:

| Event Type | When Emitted |
|------------|-------------|
| `execution_started` | After lease claim, before runLoop call |
| `execution_progress` | On each run-loop `onEvent` callback |
| `execution_completed` | After successful runLoop completion |
| `execution_interrupted` | On runLoop failure, timeout, or abort |

#### 2.2.5 Heartbeat

Worker calls `queue.heartbeat(leaseId)` every 30 seconds during execution. If the runLoop takes longer than the lease duration, the heartbeat keeps it alive. Heartbeat is cleared immediately when execution ends.

#### 2.2.6 maxTurns: 1 for Single-Turn Execution

The hosted worker executes exactly one turn per job (`maxTurns: 1`). After the turn completes and is accepted/rejected, the worker finalizes the lease. If the run has more turns to execute, a new job must be enqueued (either by the server's post-acceptance hook or by an external scheduler).

---

### 2.3 Job Queue Module — `cli/src/lib/api/job-queue.js`

**New file.** In-memory FIFO queue with lease management.

#### 2.3.1 Module API

```javascript
/**
 * Create an in-memory job queue.
 * @param {object} [options]
 * @param {number} [options.defaultLeaseDurationMs=600000] - default 10min (api_proxy)
 * @param {number} [options.heartbeatIntervalMs=30000] - expected heartbeat interval
 * @param {number} [options.staleThresholdMultiplier=2] - missed heartbeats before stale
 * @returns {JobQueue}
 */
export function createJobQueue(options)
```

#### 2.3.2 Job Shape

```javascript
{
  job_id: string,           // ULID
  project_id: string,       // from config or request
  run_id: string,           // governed run ID
  turn_id: string|null,     // if known at enqueue time
  role: string,             // target role for dispatch
  runtime_id: string,       // runtime to dispatch to
  runtime_class: string,    // 'api_proxy' or 'local_cli'
  enqueued_at: number,      // Date.now()
  status: string,           // 'waiting' | 'claimed' | 'completed' | 'failed' | 'needs_recovery'
  lease: null | ExecutionLease
}
```

#### 2.3.3 Execution Lease Shape

```javascript
{
  lease_id: string,         // ULID
  job_id: string,
  worker_id: string,
  claimed_at: number,
  expires_at: number,       // claimed_at + lease_duration
  heartbeat_at: number,     // last heartbeat timestamp
  attempt: number           // 1-indexed
}
```

#### 2.3.4 Queue Operations

| Method | Semantics | Execution Plane Spec Rule |
|--------|-----------|--------------------------|
| `enqueue(job)` | Append to project FIFO. Returns job_id | Rule 2 (FIFO) |
| `claim(workerId, runtimeClass?)` | Acquire lease on next waiting job matching worker capabilities. Returns `{ job, lease }` or null | Rule 3 (exclusive lease) |
| `heartbeat(leaseId)` | Update `heartbeat_at`. Returns boolean (false if lease expired) | Rule 3 (heartbeat) |
| `finalize(leaseId, result)` | Mark job completed/failed, release lease. `result: 'completed' | 'failed'` | Rule 4 (explicit finalization) |
| `expireStaleLeases()` | Scan leases; if `now - heartbeat_at > staleThreshold`, transition to `needs_recovery` | Rule 4 (crash recovery) |
| `getJobs(filter?)` | List jobs by status | — |
| `getStatus()` | Return queue metrics: total, waiting, claimed, completed, failed, needs_recovery | — |

#### 2.3.5 Lease Duration Defaults

Per execution plane spec behavior rule 3:
- `api_proxy`: 10 minutes (600,000 ms)
- `local_cli`: 30 minutes (1,800,000 ms)
- Default (unknown): 10 minutes

#### 2.3.6 Stale Detection

Per execution plane spec behavior rule 3:
- Heartbeat expected every 30s
- Missing 2 consecutive windows (60s without heartbeat) marks lease stale
- Stale leases transition job to `needs_recovery`
- **No auto-retry** — recovery requires explicit operator action (matches spec rule 4)

---

### 2.4 CLI Command — `cli/src/commands/serve.js`

**New file.** Starts the hosted runner.

#### 2.4.1 Usage

```
agentxchain serve [options]

Options:
  --port <number>    Server port (default: 4100)
  --host <address>   Bind address (default: 127.0.0.1)
  --project <path>   Project root (default: auto-detect)
```

#### 2.4.2 Implementation

```javascript
import { findProjectRoot, loadProjectContext } from '../lib/config.js';
import { loadNormalizedConfig } from '../lib/normalized-config.js';
import { createHostedRunner } from '../lib/api/hosted-runner.js';

export async function serveCommand(opts) {
  const root = findProjectRoot(opts.project || process.cwd());
  if (!root) { /* error: no governed project */ }
  
  const ctx = loadProjectContext(root);
  const config = loadNormalizedConfig(ctx.rawConfig, root);
  
  const runner = createHostedRunner({
    root,
    config,
    port: parseInt(opts.port || '4100', 10),
    host: opts.host || '127.0.0.1',
  });
  
  await runner.start();
  // Print: "Hosted runner listening on http://{host}:{port}"
  
  process.on('SIGINT', () => runner.stop());
  process.on('SIGTERM', () => runner.stop());
}
```

#### 2.4.3 Commander Registration

Add to `cli/src/agentxchain.js` (the main CLI entry point):
```javascript
program
  .command('serve')
  .description('Start hosted runner HTTP server')
  .option('--port <number>', 'Server port', '4100')
  .option('--host <address>', 'Bind address', '127.0.0.1')
  .option('--project <path>', 'Project root')
  .action(serveCommand);
```

---

### 2.5 Integration Tests — `cli/test/hosted-runner.test.js`

**New file.** End-to-end tests for the hosted runner.

| # | Test ID | Description | Assertion |
|---|---------|-------------|-----------|
| T1 | AT-HR-001 | Server starts and serves /health | GET /health returns `{ status: 'ok' }` with HTTP 200 |
| T2 | AT-HR-002 | Create run via POST | POST /v1/projects/:id/runs returns 201 with run state containing `status: 'active'` |
| T3 | AT-HR-003 | Get run state | GET /v1/runs/:id returns 200 with run state matching created run |
| T4 | AT-HR-004 | Worker picks up and dispatches | After run creation, worker claims job and calls dispatchApiProxy (mocked); turn result is staged |
| T5 | AT-HR-005 | Job queue FIFO and exclusivity | Enqueue 2 jobs; first claim gets job 1; second claim (while lease active) gets job 2; no double-claim |
| T6 | AT-HR-006 | Stale lease transitions to needs_recovery | Claim job, skip heartbeat for 65s (simulated), call expireStaleLeases() → job status is `needs_recovery` |
| T7 | AT-HR-007 | End-to-end lifecycle | Create run → worker executes (mocked provider returns valid turn result) → GET /turns shows completed turn |
| T8 | AT-HR-008 | Error format is standard | GET /v1/runs/nonexistent returns 404 with `{ error: { code: 'not_found', message: ... } }` |
| T9 | AT-HR-009 | Graceful shutdown | Call stop(), verify server.close() resolves, no unhandled rejections |
| T10 | AT-HR-010 | Cancel run via POST | POST /v1/runs/:id/cancel with `{ reason: 'test' }` returns 200, subsequent GET shows `status: 'blocked'` |

#### 2.5.1 Mocking Strategy

- `dispatchApiProxy` is mocked at the module level (vitest `vi.mock`) to return a valid turn result without making real HTTP calls to cloud APIs
- The mock returns `{ ok: true, accept: true, turnResult: { schema_version: '1.0', ... } }` matching the minimum turn result shape
- Job queue stale-lease test uses fake timers (`vi.useFakeTimers()`) to simulate time passage

---

## 3. Integration Points

### 3.1 Protocol Bridge — `protocol-bridge.js`

The HTTP server imports all 15 bridge functions (lines 141-476) plus 5 error classes (lines 43-88):

```javascript
import {
  createRun, getRunState, listRuns, cancelRun,
  getTurns, getTurn, acceptTurnResult, rejectTurnResult,
  approveTransition, checkpointTurn, retryTurn,
  getEvents, getDecisions, getGates, exportRun,
  ProtocolError, NotFoundError, ValidationError,
  AuthorizationError, ConflictError,
} from './protocol-bridge.js';
```

### 3.2 Run Loop — `run-loop.js:72`

The execution worker calls `runLoop(root, config, callbacks, options)` with:
- `maxTurns: 1` — single-turn execution per job
- `callbacks.dispatch` — wraps `dispatchApiProxy`
- `callbacks.selectRole` — returns the job's assigned role
- `callbacks.approveGate` — returns `true` (auto-approve in hosted mode)

### 3.3 API Proxy Adapter — `api-proxy-adapter.js:788`

The dispatch callback invokes:
```javascript
dispatchApiProxy(root, context.state, config, {
  turnId: context.turn.turn_id,
  signal: abortController.signal,
})
```

This handles provider selection, request construction, retry, cost tracking, error classification, and turn result extraction — all existing behavior used as-is.

### 3.4 Dashboard Bridge Server — Pattern Reference

`bridge-server.js:261-336` demonstrates the established `node:http` server pattern:
- `createServer(async (req, res) => { ... })` handler
- URL parsing with `new URL(req.url, 'http://localhost')`
- Path matching against a route table
- JSON response helpers

The hosted runner follows the same structural pattern but with protocol bridge integration instead of state file reads.

### 3.5 Config Loading

```javascript
import { findProjectRoot, loadProjectContext } from '../config.js';      // config.js
import { loadNormalizedConfig } from '../normalized-config.js';           // normalized-config.js
```

### 3.6 CLI Entry Point — `agentxchain.js`

The `serve` command registration follows the pattern of existing commands (e.g., `serve-mcp` at `cli/src/commands/serve-mcp.js`):
```javascript
import { serveCommand } from './commands/serve.js';
```

---

## 4. Files Changed (Expected)

| File | Change Type | Description |
|------|-------------|-------------|
| `cli/src/lib/api/hosted-runner.js` | **Create** | HTTP server module (16 routes, error mapping, graceful shutdown) |
| `cli/src/lib/api/execution-worker.js` | **Create** | Execution worker (run-loop + api_proxy composition, heartbeat, events) |
| `cli/src/lib/api/job-queue.js` | **Create** | In-memory FIFO queue with lease model |
| `cli/src/commands/serve.js` | **Create** | `agentxchain serve` CLI command |
| `cli/test/hosted-runner.test.js` | **Create** | Integration tests (10 tests) |
| `cli/src/agentxchain.js` | **Modify** | Register `serve` command (~3 lines) |

5 new files, 1 modified file. Vitest contract file count increases by 1.

---

## 5. Key Architecture Invariants

1. **Protocol parity (from frozen spec).** The hosted runner calls the same protocol primitives via protocol-bridge.js — no reimplementation of state machine logic.
2. **Zero new dependencies.** `node:http` is built-in. All composition layers (protocol bridge, run-loop, api_proxy adapter) are existing internal modules.
3. **Run-loop is THE execution engine.** The worker does not reimplement dispatch, acceptance, timeout, or retry logic — it delegates entirely to `runLoop()`.
4. **Execution plane lease model.** Queue implements spec behavior rules 2-4: FIFO, exclusive leases, heartbeat-based liveness, crash-closed recovery.
5. **Single-turn-per-job.** Each job executes exactly one turn (`maxTurns: 1`). Multi-turn runs require re-enqueue after each turn (matches the "explicit operator-driven recovery" principle).
6. **localhost-only default.** Same security posture as `bridge-server.js` — bind to 127.0.0.1 unless explicitly overridden via `--host`.

---

## Interface

### Hosted Runner Architecture

```
HTTP Client (curl, dashboard, CI)
    │
    ▼
┌─────────────────────────────┐
│  HTTP Server                 │  ← NEW: cli/src/lib/api/hosted-runner.js
│  (node:http, 16 routes,      │     Port 4100, 127.0.0.1 default
│   JSON body, error mapping)  │
├─────────────────────────────┤
│  Protocol Bridge             │  ← Existing: cli/src/lib/api/protocol-bridge.js
│  (15 functions, typed errors,│
│   state-provider seams)      │
├─────────────────────────────┤
│  Runner Interface + State    │  ← Existing: protocol SDK (v0.2)
├─────────────────────────────┤
│  Filesystem State (.agentxchain/)  │
└─────────────────────────────┘

Execution Worker (in-process)
    │
    ▼
┌─────────────────────────────┐
│  Job Queue                   │  ← NEW: cli/src/lib/api/job-queue.js
│  (FIFO, lease model,         │     In-memory, project-scoped
│   heartbeat, stale detection)│
├─────────────────────────────┤
│  Run Loop                    │  ← Existing: cli/src/lib/run-loop.js
│  (callbacks.dispatch seam)   │
├─────────────────────────────┤
│  API Proxy Adapter           │  ← Existing: cli/src/lib/adapters/api-proxy-adapter.js
│  (Anthropic, OpenAI, Google, │     dispatchApiProxy()
│   Ollama — retry, cost)      │
├─────────────────────────────┤
│  Cloud Agent API             │  ← External: api.anthropic.com, api.openai.com, etc.
└─────────────────────────────┘
```

### Request Flow (End-to-End)

```
1. Client → POST /v1/projects/:id/runs
2. Server → protocol-bridge.createRun(root, config)
3. Server → queue.enqueue({ run_id, role, runtime_id, runtime_class: 'api_proxy' })
4. Worker polls → queue.claim(workerId)
5. Worker → runLoop(root, config, { dispatch: dispatchApiProxy }, { maxTurns: 1 })
6. Run-loop → assignTurn → writeDispatchBundle → callbacks.dispatch(context)
7. dispatchApiProxy → HTTP POST to api.anthropic.com/v1/messages (or OpenAI, Google)
8. Provider response → extract turn result → stage at .agentxchain/staging/
9. Run-loop → acceptTurn (validation + state transition)
10. Worker → queue.finalize(leaseId, 'completed')
11. Client → GET /v1/runs/:id/turns → sees completed turn
```

---

## Dev Charter

### Scope

**5 new files + 1 modification: HTTP server + execution worker + job queue + serve command + integration tests + CLI registration.**

1. `cli/src/lib/api/hosted-runner.js` — HTTP server (16 routes via protocol bridge)
2. `cli/src/lib/api/execution-worker.js` — Execution worker (run-loop + api_proxy, heartbeat, events)
3. `cli/src/lib/api/job-queue.js` — In-memory FIFO queue with lease model
4. `cli/src/commands/serve.js` — `agentxchain serve` CLI command
5. `cli/test/hosted-runner.test.js` — Integration tests (10 tests)
6. `cli/src/agentxchain.js` — Register `serve` command (~3 lines)

### Out of Scope

- Cloud persistence (filesystem state-provider seams are used as-is)
- Multi-tenant org/workspace management
- Authentication/authorization enforcement (localhost-only default)
- Production deployment (Docker, systemd, infrastructure)
- Dashboard UI
- Webhook delivery
- Changes to protocol-bridge.js, run-loop.js, api-proxy-adapter.js, runner-interface.js

### Verification

Dev must confirm:
1. `agentxchain serve --port 4100` starts an HTTP server that responds to GET /health
2. POST /v1/projects/:id/runs creates a governed run
3. Execution worker picks up the job and dispatches via api_proxy (mocked in tests)
4. Job queue enforces FIFO ordering and lease exclusivity
5. Stale lease detection transitions jobs to needs_recovery
6. All 10 integration tests pass
7. Vitest contract passes with the new test file
8. No existing tests broken

## Acceptance Tests

- [ ] AT-HR-001: Server starts and serves /health → 200
- [ ] AT-HR-002: Create run via POST → 201 with active state
- [ ] AT-HR-003: Get run state → 200 with matching state
- [ ] AT-HR-004: Worker dispatches via api_proxy (mocked)
- [ ] AT-HR-005: Job queue FIFO and lease exclusivity
- [ ] AT-HR-006: Stale lease transitions to needs_recovery
- [ ] AT-HR-007: End-to-end lifecycle (create → dispatch → query turns)
- [ ] AT-HR-008: Error responses use standard format
- [ ] AT-HR-009: Graceful shutdown
- [ ] AT-HR-010: Cancel run transitions to blocked
