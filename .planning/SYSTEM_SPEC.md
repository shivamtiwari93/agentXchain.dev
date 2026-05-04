# System Spec — M8: agentxchain.ai Managed Surface — MVP — Control Plane API Design

**Run:** `run_8140752664578eb2`
**Baseline:** git:ed69787351d1d0f29201df8eb9a27834bf38b644
**Package version:** `agentxchain@2.155.72`

## Purpose

Produce the implementation-ready design for the agentxchain.ai control plane API. The frozen architecture specs (`AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md`, `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md`) define the vision and boundary. This run delivers the machine-readable API contract (OpenAPI 3.1), proves the protocol primitives are composable by an HTTP server (protocol bridge module), and validates schema compatibility between the API surface and existing protocol objects.

---

## 1. Architecture Overview

### 1.1 Existing Infrastructure

The agentxchain protocol is fully implemented as a CLI-first, filesystem-based governed execution engine:

| Layer | File | LOC | Key Exports |
|-------|------|-----|-------------|
| State machine | `cli/src/lib/governed-state.js` | 7295 | `initializeGovernedRun`, `assignGovernedTurn`, `acceptGovernedTurn`, `rejectGovernedTurn`, `approvePhaseTransition`, `markRunBlocked`, `reactivateGovernedRun`, `reissueTurn` |
| Run loop | `cli/src/lib/run-loop.js` | 877 | `runLoop(root, config, callbacks, options)` |
| Dispatch | `cli/src/lib/dispatch-bundle.js` | 1520 | `writeDispatchBundle` |
| Validation | `cli/src/lib/turn-result-validator.js` | 1950 | `validateStagedTurnResult` |
| Gates | `cli/src/lib/gate-evaluator.js` | — | `evaluatePhaseExit`, `evaluateRunCompletion` |
| Export | `cli/src/lib/export.js` | 766 | `buildExportArtifact` |
| Turn checkpoint | `cli/src/lib/turn-checkpoint.js` | 504 | `checkpointAcceptedTurn`, `restartFromCheckpoint` |
| Runner SDK | `cli/src/lib/runner-interface.js` | 64 | Re-exports 18 protocol primitives (version `0.2`) |
| Local dashboard | `cli/src/lib/dashboard/bridge-server.js` | 633 | Localhost HTTP + WebSocket (127.0.0.1 only) |
| Run history | `cli/src/lib/run-history.js` | ~100 | `recordRunHistory` (append-only JSONL) |
| Run events | `cli/src/lib/run-events.js` | — | Append-only structured event stream |
| Config | `cli/src/lib/config.js` | 184 | `loadProjectContext`, `loadProjectState` |
| Normalized config | `cli/src/lib/normalized-config.js` | 1573 | `loadNormalizedConfig`, schema validation |

### 1.2 Frozen Architecture Specs

| Spec | File | Key Contribution |
|------|------|-----------------|
| Managed surface | `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md` | Architecture boundary, protocol parity invariant, 4-layer decomposition |
| Control plane API | `AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md` | 29 endpoint paths, 6 object schemas, RBAC model, 8 acceptance tests |
| Execution plane | `AGENTXCHAIN_AI_EXECUTION_PLANE_SPEC.md` | Queue topology, lease model, worker capabilities, 12 acceptance tests |
| Portability | `AGENTXCHAIN_AI_PORTABILITY_SPEC.md` | Export/import bundle format, round-trip semantics, 9 acceptance tests |

### 1.3 Gap Analysis

The frozen specs define endpoints as prose tables and partial JSON examples. What is missing for implementability:

| Gap | Impact |
|-----|--------|
| No machine-readable API contract | Cannot validate, generate stubs, or import into API tools |
| No full request/response schemas | Implementers must guess field types and validation rules |
| No HTTP status codes per endpoint | Error handling is undefined |
| No error response format | Clients cannot programmatically handle failures |
| No pagination response wrapper | List endpoints have undefined response shape |
| No protocol bridge module | No proof that runner-interface.js composes for HTTP |
| No schema compatibility validation | API objects may drift from protocol state shapes |

---

## 2. Deliverables

### 2.1 OpenAPI 3.1 Specification — `api/v1/control-plane.openapi.yaml`

**New file.** Machine-readable API contract for the control plane.

Source contract: `.planning/AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md`

#### 2.1.1 Endpoints (29 operations)

**Tenancy (9 operations):**

| Method | Path | operationId | Tag | RBAC |
|--------|------|-------------|-----|------|
| POST | `/v1/orgs` | createOrganization | tenancy | owner |
| GET | `/v1/orgs/{org_id}` | getOrganization | tenancy | viewer |
| POST | `/v1/orgs/{org_id}/workspaces` | createWorkspace | tenancy | owner |
| GET | `/v1/orgs/{org_id}/workspaces` | listWorkspaces | tenancy | viewer |
| GET | `/v1/workspaces/{ws_id}` | getWorkspace | tenancy | viewer |
| PATCH | `/v1/workspaces/{ws_id}` | updateWorkspace | tenancy | owner |
| POST | `/v1/workspaces/{ws_id}/projects` | createProject | tenancy | operator |
| GET | `/v1/workspaces/{ws_id}/projects` | listProjects | tenancy | viewer |
| GET | `/v1/projects/{proj_id}` | getProject | tenancy | viewer |

**Run Lifecycle (9 operations):**

| Method | Path | operationId | Tag | RBAC |
|--------|------|-------------|-----|------|
| POST | `/v1/projects/{proj_id}/runs` | createRun | runs | operator |
| GET | `/v1/projects/{proj_id}/runs` | listRuns | runs | viewer |
| GET | `/v1/runs/{run_id}` | getRun | runs | viewer |
| GET | `/v1/runs/{run_id}/turns` | listTurns | turns | viewer |
| GET | `/v1/runs/{run_id}/turns/{turn_id}` | getTurn | turns | viewer |
| GET | `/v1/runs/{run_id}/decisions` | getDecisions | runs | viewer |
| GET | `/v1/runs/{run_id}/gates` | getGates | runs | viewer |
| POST | `/v1/runs/{run_id}/cancel` | cancelRun | runs | operator |

**Approvals & Recovery (6 operations):**

| Method | Path | operationId | Tag | RBAC |
|--------|------|-------------|-----|------|
| POST | `/v1/runs/{run_id}/approve-transition` | approveTransition | approvals | operator |
| POST | `/v1/runs/{run_id}/turns/{turn_id}/accept` | acceptTurn | approvals | operator |
| POST | `/v1/runs/{run_id}/turns/{turn_id}/reject` | rejectTurn | approvals | operator |
| POST | `/v1/runs/{run_id}/checkpoint` | checkpointRun | approvals | operator |
| POST | `/v1/runs/{run_id}/restart` | restartRun | approvals | operator |
| POST | `/v1/runs/{run_id}/retry` | retryTurn | approvals | operator |

**Audit & Events (4 operations):**

| Method | Path | operationId | Tag | RBAC |
|--------|------|-------------|-----|------|
| GET | `/v1/runs/{run_id}/events` | getRunEvents | audit | viewer |
| GET | `/v1/workspaces/{ws_id}/audit` | getWorkspaceAudit | audit | viewer |
| GET | `/v1/runs/{run_id}/export` | exportRun | audit | operator |
| POST | `/v1/projects/{proj_id}/import` | importRun | audit | operator |

**Webhooks (1 operation):**

| Method | Path | operationId | Tag | RBAC |
|--------|------|-------------|-----|------|
| POST | `/v1/workspaces/{ws_id}/webhooks` | registerWebhook | webhooks | operator |

#### 2.1.2 Component Schemas

Every schema must match the corresponding protocol object shape. Source of truth:

| Schema | Protocol Source | Key Fields |
|--------|----------------|------------|
| `Organization` | Frozen spec (cloud-only tenancy) | `id` (org_ulid), `name`, `created_at`, `owner_id` |
| `Workspace` | Frozen spec (cloud-only tenancy) | `id` (ws_ulid), `org_id`, `name`, `policy`, `created_at` |
| `Project` | `agentxchain.json` schema | `id` (proj_ulid), `ws_id`, `name`, `repo_url`, `governance_config`, `protocol_version` |
| `Run` | `.agentxchain/state.json` | `id` (run_ulid), `proj_id`, `phase`, `status`, `turns[]`, `gates{}`, `decision_ledger[]`, `created_at`, `updated_at` |
| `Turn` | `.agentxchain/history.jsonl` entries | `id` (turn_ulid), `run_id`, `role`, `runtime_id`, `phase`, `status`, `summary`, `files_changed[]`, `verification{}`, `artifact{}` |
| `Decision` | `.agentxchain/decision-ledger.jsonl` | `id` (DEC-NNN), `category`, `statement`, `rationale`, `phase`, `role`, `runtime_id` |
| `Gate` | `gate-evaluator.js` output | `name`, `status` (pending/passed/failed), `evidence{}`, `missing_files[]`, `requires_human_approval` |
| `Event` | `.agentxchain/events.jsonl` | `id`, `type`, `timestamp`, `run_id`, `turn_id`, `data{}` |
| `AuditEntry` | Cloud-only (new) | `id`, `actor_id`, `actor_role`, `timestamp`, `action`, `target`, `target_id`, `metadata{}` |
| `Error` | New (standard) | `code` (string), `message` (string), `details` (object, optional) |
| `PaginatedList` | New (standard) | `data` (array), `cursor` (string or null), `has_more` (boolean) |

#### 2.1.3 Security Schemes

```yaml
components:
  securitySchemes:
    api_key:
      type: apiKey
      in: header
      name: X-API-Key
    bearer_auth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

All endpoints require one of `api_key` or `bearer_auth`. RBAC annotations use `x-required-role` extension per operation.

#### 2.1.4 Error Format

Standard error response on all non-2xx responses:

```json
{
  "error": {
    "code": "run_not_found",
    "message": "Run run_01HZ... does not exist in project proj_01HZ...",
    "details": {}
  }
}
```

Error code taxonomy:
- Generic: `not_found`, `already_exists`, `invalid_request`, `unauthorized`, `forbidden`, `rate_limited`, `internal_error`
- Protocol: `invalid_state`, `gate_not_satisfied`, `turn_not_active`, `run_not_resumable`, `checkpoint_not_found`, `protocol_version_mismatch`, `lock_conflict`

#### 2.1.5 Pagination

Cursor-based pagination on all list endpoints (per frozen spec behavior rule 4):

```yaml
parameters:
  cursor:
    name: cursor
    in: query
    schema:
      type: string
    description: Opaque cursor from previous response
  limit:
    name: limit
    in: query
    schema:
      type: integer
      minimum: 1
      maximum: 100
      default: 25
```

Response wrapper:
```yaml
PaginatedList:
  type: object
  required: [data, has_more]
  properties:
    data:
      type: array
    cursor:
      type: string
      nullable: true
    has_more:
      type: boolean
```

---

### 2.2 Protocol Bridge Module — `cli/src/lib/api/protocol-bridge.js`

**New file.** Wraps `runner-interface.js` primitives for HTTP consumption.

#### 2.2.1 Exports

| Function | Wraps | HTTP Mapping | Runner Export Used |
|----------|-------|--------------|--------------------|
| `createRun(root, config, opts)` | `initRun` | POST `/v1/projects/:proj_id/runs` | `initRun` |
| `getRunState(root, config)` | `loadState` | GET `/v1/runs/:run_id` | `loadState` |
| `listRuns(root, config, cursor, limit)` | `run-history.js` | GET `/v1/projects/:proj_id/runs` | — (direct file read) |
| `cancelRun(root, config, reason)` | `markRunBlocked` | POST `/v1/runs/:run_id/cancel` | `markRunBlocked` |
| `getTurns(root, cursor, limit)` | reads `history.jsonl` | GET `/v1/runs/:run_id/turns` | — (direct file read) |
| `getTurn(root, turnId)` | reads history + staging | GET `/v1/runs/:run_id/turns/:turn_id` | `getTurnStagingResultPath` |
| `acceptTurnResult(root, config, turnId, opts)` | `acceptTurn` | POST `…/turns/:turn_id/accept` | `acceptTurn`, `acquireLock`, `releaseLock` |
| `rejectTurnResult(root, config, turnId, opts)` | `rejectTurn` | POST `…/turns/:turn_id/reject` | `rejectTurn`, `acquireLock`, `releaseLock` |
| `approveTransition(root, config, opts)` | `approvePhaseGate` | POST `…/approve-transition` | `approvePhaseGate` |
| `checkpointTurn(root, turnId)` | `turn-checkpoint.js` | POST `…/checkpoint` | — (`checkpointAcceptedTurn`) |
| `restartFromCheckpoint(root, ckptId)` | `turn-checkpoint.js` | POST `…/restart` | — (`restartFromCheckpoint`) |
| `retryTurn(root, config, turnId)` | `reissueTurn` | POST `…/retry` | `reissueTurn` |
| `getEvents(root, cursor, limit)` | reads `events.jsonl` | GET `…/events` | — (direct file read) |
| `getDecisions(root)` | reads `decision-ledger.jsonl` | GET `…/decisions` | — (direct file read) |
| `getGates(root, config)` | reads gate state | GET `…/gates` | — (from state + gate-evaluator) |
| `exportRun(root, config)` | `buildExportArtifact` | GET `…/export` | — (`export.js`) |

#### 2.2.2 Design Principles

1. **No HTTP objects.** The bridge takes protocol-level arguments (`root`, `config`, `turnId`, `opts`) and returns JSON-serializable protocol-level results. HTTP request/response mapping is the server's responsibility.
2. **Typed error classification.** The bridge throws typed errors that a server maps to HTTP status codes:

   | Error Class | HTTP Status | When Thrown |
   |-------------|-------------|------------|
   | `ProtocolError` | 409 | State machine rejects operation (e.g., approve gate when no transition pending) |
   | `NotFoundError` | 404 | Run, turn, checkpoint, or gate does not exist |
   | `ValidationError` | 422 | Request body fails protocol validation |
   | `AuthorizationError` | 403 | Insufficient RBAC role for the operation |
   | `ConflictError` | 409 | Lock acquisition failed (concurrent mutation) |

3. **State-provider seam.** Each function that reads/writes filesystem state documents the seam with `@state-provider` JSDoc annotation. When the cloud implementation replaces filesystem with service storage, these seams are the adapter injection points.
4. **No side effects beyond protocol state.** The bridge does not send notifications, emit metrics, or write logs. Those are server-layer concerns.

#### 2.2.3 State-Provider Seam Documentation

The bridge module must annotate every filesystem operation:

```javascript
/**
 * @state-provider readState
 * Reads: .agentxchain/state.json
 * Cloud replacement: state store GET by run_id
 */

/**
 * @state-provider writeState
 * Writes: .agentxchain/state.json
 * Cloud replacement: state store PUT by run_id (compare-and-swap)
 */

/**
 * @state-provider readHistory
 * Reads: .agentxchain/history.jsonl
 * Cloud replacement: turn history query by run_id with cursor
 */

/**
 * @state-provider readEvents
 * Reads: .agentxchain/events.jsonl
 * Cloud replacement: event store query by run_id with cursor
 */

/**
 * @state-provider readDecisions
 * Reads: .agentxchain/decision-ledger.jsonl
 * Cloud replacement: decision ledger query by run_id
 */

/**
 * @state-provider acquireLock
 * Reads/writes: .agentxchain/lock.json
 * Cloud replacement: distributed lock (lease-based, workspace-scoped)
 */
```

---

### 2.3 Schema Compatibility Tests — `cli/test/api/control-plane-schema.test.js`

**New file.** Validates the design artifacts against protocol contracts.

| # | Test ID | Description | Assertion |
|---|---------|-------------|-----------|
| T1 | AT-CP-SCHEMA-001 | OpenAPI spec is valid | `api/v1/control-plane.openapi.yaml` parses as valid YAML and conforms to OpenAPI 3.1 structure |
| T2 | AT-CP-SCHEMA-002 | Endpoint coverage | Every endpoint path from the frozen spec has a corresponding OpenAPI operation (29 operations) |
| T3 | AT-CP-SCHEMA-003 | Run schema matches state.json | Run response schema includes `phase`, `status`, `gates`, `turns`, `created_at`, `updated_at` |
| T4 | AT-CP-SCHEMA-004 | Turn schema matches history.jsonl | Turn response schema includes `role`, `runtime_id`, `status`, `summary`, `files_changed`, `verification`, `artifact` |
| T5 | AT-CP-SCHEMA-005 | Decision schema matches ledger | Decision response schema includes `id`, `category`, `statement`, `rationale` |
| T6 | AT-CP-SCHEMA-006 | Bridge export coverage | Protocol bridge exports cover all mutating API operations (accept, reject, approve, checkpoint, restart, retry, cancel, create) |
| T7 | AT-CP-SCHEMA-007 | No cloud-only governance | API response schemas contain no governance-affecting fields beyond protocol state; cloud-only fields are restricted to `display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state` |

Dev may use `js-yaml` for YAML parsing. OpenAPI structure validation can be done by checking required top-level keys (`openapi`, `info`, `paths`, `components`) and verifying each path entry has `operationId`, `responses`, and `tags`. Full JSON Schema validation of the OpenAPI spec against the OpenAPI 3.1 meta-schema is acceptable but not required — structural checks suffice.

---

## 3. Integration Points

### 3.1 Runner Interface — `runner-interface.js:27-59`

The protocol bridge wraps these exports:

| Runner Export | Bridge Function | Runner Line |
|---------------|----------------|-------------|
| `initRun` (line 28) | `createRun` | `governed-state.js` → `initializeGovernedRun` |
| `loadState` (line 23) | `getRunState` | `config.js` → `loadProjectState` |
| `acceptTurn` (line 30) | `acceptTurnResult` | `governed-state.js` → `acceptGovernedTurn` |
| `rejectTurn` (line 31) | `rejectTurnResult` | `governed-state.js` → `rejectGovernedTurn` |
| `approvePhaseGate` (line 32) | `approveTransition` | `governed-state.js` → `approvePhaseTransition` |
| `markRunBlocked` (line 34) | `cancelRun` | `governed-state.js` → `markRunBlocked` |
| `reissueTurn` (line 44) | `retryTurn` | `governed-state.js` → `reissueTurn` |
| `acquireLock` (line 40) | Used internally by mutations | `governed-state.js` → `acquireAcceptanceLock` |
| `releaseLock` (line 41) | Used internally by mutations | `governed-state.js` → `releaseAcceptanceLock` |
| `writeDispatchBundle` (line 49) | Not wrapped (server-layer) | `dispatch-bundle.js` |
| `getTurnStagingResultPath` (line 50) | Used by `getTurn` | `turn-paths.js` |

Functions NOT wrapped by the bridge (runner-specific, not HTTP-applicable):
- `assignTurn` — turn assignment is orchestrator-driven, not API-driven
- `getActiveTurns`, `getActiveTurnCount`, `getActiveTurn` — subsumed by `getRunState`
- `refreshTurnBaselineSnapshot` — internal to run loop
- `transitionActiveTurnLifecycle` — internal to run loop
- `runHooks`, `emitNotifications` — server-layer concerns
- `getMaxConcurrentTurns` — config utility, not an API operation

### 3.2 State Files (Read/Write Mapping)

| File | Bridge Read Functions | Bridge Write Functions |
|------|----------------------|----------------------|
| `.agentxchain/state.json` | `getRunState`, `getGates` | `createRun`, `acceptTurnResult`, `rejectTurnResult`, `approveTransition`, `cancelRun`, `retryTurn` |
| `.agentxchain/history.jsonl` | `getTurns`, `getTurn` | `acceptTurnResult`, `rejectTurnResult` (via protocol) |
| `.agentxchain/decision-ledger.jsonl` | `getDecisions` | `acceptTurnResult` (via validation) |
| `.agentxchain/events.jsonl` | `getEvents` | All mutations (via `run-events.js`) |
| `.agentxchain/lock.json` | — | `acceptTurnResult`, `rejectTurnResult` (acquire/release) |

### 3.3 Turn Checkpoint — `turn-checkpoint.js`

| Function | Bridge Function | Line |
|----------|----------------|------|
| `checkpointAcceptedTurn` | `checkpointTurn` | `turn-checkpoint.js` |
| `restartFromCheckpoint` | `restartFromCheckpoint` | `turn-checkpoint.js` |

### 3.4 Export — `export.js`

| Function | Bridge Function | Line |
|----------|----------------|------|
| `buildExportArtifact` | `exportRun` | `export.js` |

### 3.5 Existing Dashboard Bridge — `bridge-server.js`

The existing dashboard bridge server (`bridge-server.js:261`) is **not modified** by this run. It serves a different purpose:
- Localhost-only (127.0.0.1), read-heavy, WebSocket push for file changes
- The control plane API is a separate, remotely-accessible surface with full RBAC

The two surfaces may share code in the future but are architecturally distinct.

---

## 4. Files Changed (Expected)

| File | Change Type | Description |
|------|-------------|-------------|
| `api/v1/control-plane.openapi.yaml` | **Create** | OpenAPI 3.1 specification (29 operations, 11+ schemas) |
| `cli/src/lib/api/protocol-bridge.js` | **Create** | Protocol bridge module (16 exports, typed errors, seam docs) |
| `cli/test/api/control-plane-schema.test.js` | **Create** | Schema compatibility tests (7 tests) |

3 new files. No modifications to existing files. Vitest contract file count increases by 1.

---

## 5. Key Architecture Invariants

1. **Protocol parity (from frozen spec DEC-AI-MANAGED-SURFACE-ARCH-001).** Every API endpoint produces the same state transitions as the equivalent CLI command. The bridge calls the same protocol primitives — no reimplementation.
2. **No HTTP objects in the bridge.** The bridge is a pure protocol-to-protocol adapter. HTTP request/response mapping is the server's job.
3. **State-provider seam.** Every filesystem operation is documented so cloud storage can replace filesystem without changing protocol logic.
4. **Error classification.** Protocol errors, not-found errors, validation errors, and authorization errors are typed so the server maps them to HTTP status codes deterministically.
5. **Cloud-only metadata is presentation-only.** The API spec allows `display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state` as cloud-only fields. These never affect turn acceptance, gate evaluation, or decision outcomes.
6. **Cursor-based pagination (from frozen spec behavior rule 4).** No offset pagination — unreliable with append-only event streams.

---

## Interface

### Control Plane API ↔ Protocol Layer Architecture

```
HTTP Client (dashboard, CI, third-party)
    │
    ▼
┌─────────────────────────┐
│  HTTP Server             │  ← Future: ROADMAP.md:95 "Implement hosted runner"
│  (auth, rate limit,      │
│   request parsing,       │
│   response formatting)   │
├─────────────────────────┤
│  Protocol Bridge         │  ← THIS RUN: cli/src/lib/api/protocol-bridge.js
│  (HTTP-free wrapper      │
│   around runner SDK,     │
│   typed errors,          │
│   state-provider seam)   │
├─────────────────────────┤
│  Runner Interface        │  ← Existing: cli/src/lib/runner-interface.js (v0.2)
│  (protocol SDK:          │
│   18 primitives)         │
├─────────────────────────┤
│  Governed State Machine  │  ← Existing: cli/src/lib/governed-state.js (7295 LOC)
│  + Gate Evaluator        │
│  + Turn Validator        │
├─────────────────────────┤
│  State Storage           │  ← CLI: .agentxchain/ filesystem
│                          │     Cloud: service store (seam documented)
└─────────────────────────┘
```

### Protocol Bridge Error Types

| Error Type | HTTP Status | When Thrown |
|------------|-------------|------------|
| `ProtocolError` | 409 Conflict | State machine rejects operation |
| `NotFoundError` | 404 Not Found | Run, turn, checkpoint, or gate does not exist |
| `ValidationError` | 422 Unprocessable Entity | Request body fails protocol validation |
| `AuthorizationError` | 403 Forbidden | Insufficient RBAC role |
| `ConflictError` | 409 Conflict | Lock acquisition failed |

## Dev Charter

### Scope

**3 new files: OpenAPI spec + protocol bridge + schema tests.**

1. `api/v1/control-plane.openapi.yaml` — Full OpenAPI 3.1 specification (29 operations, 11+ component schemas, security schemes, error format, pagination)
2. `cli/src/lib/api/protocol-bridge.js` — Protocol bridge module (16 exports, 5 typed error classes, state-provider seam documentation)
3. `cli/test/api/control-plane-schema.test.js` — Schema compatibility tests (7 tests)

### Out of Scope

- HTTP server implementation
- Cloud persistence layer / database schema
- Authentication provider integration
- Dashboard UI
- Execution plane workers / queue infrastructure
- Webhook delivery implementation
- Changes to `runner-interface.js`, `governed-state.js`, or any existing source files

### Verification

Dev must confirm:
1. `api/v1/control-plane.openapi.yaml` exists and is valid YAML with OpenAPI 3.1 structure
2. OpenAPI spec has 29 operations matching the frozen spec's endpoint tables
3. Protocol bridge exports cover all mutating API operations
4. All 7 schema compatibility tests pass
5. Vitest contract passes with the new test file
6. No existing tests broken

## Acceptance Tests

- [ ] AT-CP-SCHEMA-001: OpenAPI spec is valid OpenAPI 3.1
- [ ] AT-CP-SCHEMA-002: Every frozen-spec endpoint has a corresponding OpenAPI operation
- [ ] AT-CP-SCHEMA-003: Run response schema matches state.json structure
- [ ] AT-CP-SCHEMA-004: Turn response schema matches history.jsonl entry structure
- [ ] AT-CP-SCHEMA-005: Decision response schema matches decision-ledger.jsonl entry structure
- [ ] AT-CP-SCHEMA-006: Protocol bridge exports cover all mutating API operations
- [ ] AT-CP-SCHEMA-007: No governance-affecting fields in cloud-only metadata
