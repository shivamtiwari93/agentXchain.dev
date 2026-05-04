# PM Signoff — M8: agentxchain.ai Managed Surface — MVP — Control Plane API Design

Approved: YES

**Run:** `run_8140752664578eb2`
**Phase:** planning
**Turn:** `turn_2d28df23a61fa15c`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators who need remote/programmatic run management — teams that want to govern runs from a cloud dashboard, CI pipeline, or third-party integration instead of only via the local CLI.

### Core Pain Point

AgentXchain currently has no HTTP API contract for remote run management. The entire governed lifecycle (init run, assign turn, accept, reject, approve gates, checkpoint, restart, retry) is accessible only through:
1. The CLI (`agentxchain run`, `agentxchain step`)
2. The local dashboard bridge server (`bridge-server.js` — localhost-only, read-heavy, minimal mutations)
3. Direct library imports via `runner-interface.js`

This means:
- No remote triggering or monitoring of governed runs
- No programmatic integration for CI/CD pipelines
- No foundation for the `.ai` managed cloud surface
- No standardized API contract for third-party tooling

The frozen architecture specs define the vision and architecture boundary:
- `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md` — architecture boundary, protocol parity invariant
- `AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md` — endpoint paths, object schemas, behavior rules
- `AGENTXCHAIN_AI_EXECUTION_PLANE_SPEC.md` — queue topology, lease model, worker capabilities
- `AGENTXCHAIN_AI_PORTABILITY_SPEC.md` — export/import bundle format, round-trip semantics

**But no concrete, machine-readable API specification exists.** The frozen specs define endpoints as prose tables and partial JSON examples. Missing: full request/response schemas, HTTP status codes, error format, pagination wrapper, authentication headers, and a module proving the protocol is composable by an HTTP server.

## Challenge to Previous Turn

### OBJ-PM-001: Planning artifacts describe M7 doctor acceptance (run_3da0168fc830ad47, ROADMAP.md:91) — this run targets M8 control plane API design (ROADMAP.md:94) (severity: high)

All three planning artifacts were written for the previous run's scope:
- PM_SIGNOFF.md scoped doctor health check per connector type
- SYSTEM_SPEC.md described `doctor.js` changes (import + Codex recognition branch)
- ROADMAP.md phases table showed doctor implementation phases for `run_3da0168fc830ad47`

This run targets ROADMAP.md:94 — "Design control plane API for remote run management" under M8: agentxchain.ai Managed Surface — MVP. All three artifacts rewritten from scratch.

### Core Workflow (this run)

1. **PM (this turn)** — Scope control plane API design deliverables, define dev charter
2. **Dev** — Produce OpenAPI 3.1 spec, protocol bridge module, schema compatibility tests
3. **QA** — Validate OpenAPI spec, verify bridge coverage, confirm protocol compatibility

### MVP Scope (this run)

**This run scopes ROADMAP.md:94 — "Design control plane API for remote run management."**

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: M8 scope, design decisions, acceptance criteria
2. SYSTEM_SPEC.md: Technical spec for API design artifacts with file:line references
3. ROADMAP.md: Update phases table for M8 control plane API scope

**Dev deliverables:**
1. `api/v1/control-plane.openapi.yaml` — OpenAPI 3.1 specification for the control plane API (29 operations, 11+ component schemas, security schemes, error format, pagination)
2. `cli/src/lib/api/protocol-bridge.js` — Module wrapping `runner-interface.js` primitives for HTTP consumption with typed error classes and state-provider seam documentation
3. `cli/test/api/control-plane-schema.test.js` — Tests validating OpenAPI spec validity, bridge coverage, and protocol schema compatibility

### Out of Scope

- HTTP server implementation (future ROADMAP.md:95 — "Implement hosted runner that executes protocol against cloud agent APIs")
- Cloud persistence layer / database schema
- OAuth provider integration / user management service
- Organization dashboard UI (future ROADMAP.md:96)
- Execution plane workers / queue infrastructure
- Webhook delivery implementation (the OpenAPI spec defines the webhook contract; implementation is separate)
- Portability endpoint implementation (export/import — design only in the OpenAPI spec)
- Rate limiting implementation
- Changes to the existing local dashboard bridge server (`bridge-server.js`)
- Changes to `runner-interface.js` or `governed-state.js`
- Windsurf / OpenCode connectors (M7 scope)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP | ROADMAP.md:94 scoped with planning artifacts |
| 2 | Unchecked roadmap item completed: Design control plane API for remote run management | OpenAPI 3.1 spec covers all frozen-spec endpoints + protocol bridge proves implementability + schema tests verify compatibility |
| 3 | Evidence source: .planning/ROADMAP.md:94 | ROADMAP.md:94 checked off after QA verification |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| OpenAPI spec diverges from frozen architecture specs | Medium | Schema compatibility test AT-CP-SCHEMA-002 validates every endpoint against the frozen spec's endpoint table |
| Protocol bridge cannot wrap all runner-interface.js primitives | Low | All primitives are pure functions with explicit inputs/outputs; bridge is thin wrapper with no new protocol logic |
| Design introduces cloud-only governance semantics | High | Test AT-CP-SCHEMA-007 validates no governance-affecting fields beyond protocol state; only presentation-tier cloud-only fields allowed |
| OpenAPI spec too abstract to implement against | Medium | Every endpoint has full request body, response body, status codes, and error format — not just path + description |

### Design Decision: OpenAPI 3.1 as Primary Design Artifact (DEC-001)

The control plane API design is captured as an **OpenAPI 3.1 specification** rather than additional prose documentation because:
1. **Machine-readable** — can be validated, used for code generation, imported into API testing tools
2. **Precise** — forces explicit request/response schemas, status codes, and error contracts
3. **Living** — the spec file is the source of truth for the API contract, not a document that drifts
4. **Composable** — future server implementations (Node.js, Go, etc.) can generate stubs from the spec

### Design Decision: Protocol Bridge Module (DEC-002)

The protocol bridge module (`cli/src/lib/api/protocol-bridge.js`) wraps `runner-interface.js` primitives with:
1. HTTP-friendly signatures (protocol-level args → protocol-level results, no HTTP objects)
2. Typed error classification (ProtocolError, NotFoundError, ValidationError, AuthorizationError)
3. State-provider seam documentation (every filesystem operation annotated for cloud replacement)
4. No side effects beyond protocol state (no notifications, metrics, or logs)

This module proves the protocol is composable by an HTTP server without modifying the protocol layer.

### Design Decision: Scoping to Run Management as Primary, Full Surface for Completeness (DEC-003)

ROADMAP.md:94 says "Design control plane API for **remote run management**." The OpenAPI spec covers the full surface (tenancy + run lifecycle + approvals + audit) because the frozen control plane spec defines them as a unit. However, run management endpoints (create, get, list, cancel, accept, reject, approve, checkpoint, restart, retry) are the primary deliverable — tenancy endpoints are included for completeness but are not the acceptance-gating concern.

## Notes for Dev

**Your charter is 3 new files: OpenAPI spec, protocol bridge, schema tests.**

### 1. OpenAPI 3.1 Specification — `api/v1/control-plane.openapi.yaml`

Source contract: `.planning/AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md`

Must include:
- **Info block:** title `AgentXchain Control Plane API`, version `0.1.0`
- **Security schemes:** `api_key` (X-API-Key header) and `bearer_auth` (Bearer token)
- **Tags:** `tenancy`, `runs`, `turns`, `approvals`, `audit`, `webhooks`
- **29 operations** matching the frozen spec's endpoint tables (9 tenancy + 9 run lifecycle + 6 approvals/recovery + 4 audit + 1 webhook)
- **11+ component schemas** matching protocol objects: Organization, Workspace, Project, Run, Turn, Decision, Gate, Event, AuditEntry, Error, PaginatedList
- **HTTP status codes** per endpoint (200, 201, 400, 401, 403, 404, 409, 422, 429, 500)
- **Error response format:** `{ error: { code, message, details? } }`
- **Cursor-based pagination:** `?cursor=<opaque>&limit=<n>`, response `{ data, cursor, has_more }`
- **RBAC annotations** via `x-required-role` extension (owner/operator/viewer)

### 2. Protocol Bridge Module — `cli/src/lib/api/protocol-bridge.js`

15 exports wrapping runner-interface.js. See SYSTEM_SPEC.md §2.2 for the full export table.

Key constraints:
- No HTTP objects (no req/res) — pure protocol-to-protocol adapter
- Typed errors: `ProtocolError`, `NotFoundError`, `ValidationError`, `AuthorizationError`, `ConflictError`
- `@state-provider` JSDoc on every filesystem operation
- No side effects beyond protocol state mutations

### 3. Schema Compatibility Tests — `cli/test/api/control-plane-schema.test.js`

7 tests. See SYSTEM_SPEC.md §2.3 for the full test table.

Dev may use `js-yaml` for YAML parsing and manual schema checks, or install an OpenAPI validator if preferred. The tests must confirm the spec is valid OpenAPI 3.1 and that response schemas match protocol object shapes.

**Vitest contract file count increases by 1** (1 new test file). Dev must update the vitest file count contract accordingly.

## Notes for QA

- Verify `api/v1/control-plane.openapi.yaml` is valid OpenAPI 3.1
- Verify protocol bridge exports cover all mutating API endpoints
- Verify schema compatibility tests pass
- Run full test suite: `cd cli && npm test`
- After ship: verify ROADMAP.md:94 can be checked off

## Acceptance Contract

1. **Roadmap milestone addressed: M8: agentxchain.ai Managed Surface — MVP** — ROADMAP.md:94 scoped with planning artifacts; control plane API design delivered as OpenAPI 3.1 spec + protocol bridge module + schema compatibility tests
2. **Unchecked roadmap item completed: Design control plane API for remote run management** — OpenAPI 3.1 spec covers all 29 frozen-spec endpoints with full request/response schemas; protocol bridge wraps runner-interface.js for HTTP consumption; schema tests verify compatibility with existing protocol state shapes
3. **Evidence source: .planning/ROADMAP.md:94** — ROADMAP.md:94 checked off after QA full suite verification
