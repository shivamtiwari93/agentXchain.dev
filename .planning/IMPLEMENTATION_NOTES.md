# Implementation Notes — M8: Control Plane API Design

**Run:** `run_8140752664578eb2`
**Turn:** `turn_16de2da8ae62750c`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Delivered the machine-readable control plane API contract and protocol bridge proving composability for HTTP consumption. Three new files: OpenAPI 3.1 specification (29 operations), protocol bridge module (15 exports + 5 error classes), and schema compatibility tests (7 tests).

## Changes

**`api/v1/control-plane.openapi.yaml`** — New OpenAPI 3.1 specification:
- 29 operations across 6 tags (tenancy, runs, turns, approvals, audit, webhooks)
- 12 component schemas (Organization, Workspace, WorkspacePolicy, Project, Run, Turn, Decision, Gate, Event, AuditEntry, Error, PaginatedList)
- 2 security schemes (api_key X-API-Key header, bearer_auth JWT)
- 6 path parameters, 2 pagination query parameters (cursor, limit)
- 8 reusable error response components (400–500)
- RBAC annotations via `x-required-role` extension on every operation
- Cursor-based pagination on all list endpoints per frozen spec behavior rule 4

**`cli/src/lib/api/protocol-bridge.js`** — New protocol bridge module:
- 15 exported functions wrapping runner-interface.js and related modules
- 5 typed error classes: ProtocolError, NotFoundError, ValidationError, AuthorizationError, ConflictError
- `@state-provider` JSDoc annotations on every filesystem operation documenting cloud replacement seams
- No HTTP objects — pure protocol-to-protocol adapter
- Internal pagination helper for JSONL-based cursoring

**`cli/test/control-plane-schema.test.js`** — New schema compatibility tests:
- AT-CP-SCHEMA-001: OpenAPI 3.1 structural validity
- AT-CP-SCHEMA-002: 29 frozen-spec endpoint coverage
- AT-CP-SCHEMA-003: Run schema matches state.json structure
- AT-CP-SCHEMA-004: Turn schema matches history.jsonl entry structure
- AT-CP-SCHEMA-005: Decision schema matches decision-ledger.jsonl entry structure
- AT-CP-SCHEMA-006: Bridge export coverage (8 mutating + 7 read + 5 error classes)
- AT-CP-SCHEMA-007: No governance-affecting fields in cloud-only metadata

**`cli/test/vitest-contract.test.js`** — Updated file count 667 → 668.

**`cli/package.json`** — Added `js-yaml` as devDependency for test YAML parsing.

### PM Charter Challenge

Three errors found in PM's SYSTEM_SPEC:

1. **OBJ-DEV-001 (medium): `buildExportArtifact` does not exist.** PM SYSTEM_SPEC §2.2 says `exportRun` wraps `buildExportArtifact`. Actual export: `buildRunExport(startDir, exportOpts)` in `export.js:463`. Bridge wraps `buildRunExport` instead.

2. **OBJ-DEV-002 (medium): `restartFromCheckpoint` does not exist.** PM SYSTEM_SPEC §2.2 and §3.3 say bridge wraps `restartFromCheckpoint` from `turn-checkpoint.js`. Only `detectPendingCheckpoint` and `checkpointAcceptedTurn` are exported. Protocol layer has no restart primitive. Bridge has 15 exports (not 16). The `restartRun` OpenAPI endpoint is documented as design-only until the protocol adds the primitive.

3. **OBJ-DEV-003 (low): Run Lifecycle count mismatch.** PM header says "9 operations" but table has 8 rows. Frozen spec implies a 29th endpoint `GET /v1/workspaces/{ws_id}/webhooks` (list webhooks). Added as `listWebhooks` under webhooks tag (2 webhook operations) to reach 29 total.

### Design Decisions

- **Test file placement:** PM chartered `cli/test/api/control-plane-schema.test.js` but `vitest-contract.test.js:108` hygiene rule only allows `fixtures` and `beta-tester-scenarios` directories in `cli/test/`. Placed test at `cli/test/control-plane-schema.test.js` instead to avoid modifying hygiene constraints.
- **Bridge drops restartFromCheckpoint:** Since the underlying protocol primitive doesn't exist, including a stub would falsely claim composability. The OpenAPI endpoint exists for API design completeness with a note that the bridge will add the function when the protocol does.

## Verification

| Test File | Tests | Result |
|-----------|-------|--------|
| `control-plane-schema.test.js` | 7 | 7/7 pass |
| `vitest-contract.test.js` | 11 | 11/11 pass |
| `governed-state.test.js` | (included in broader run) | Pass |
| `runner-interface.test.js` | (included in broader run) | Pass |
| `turn-checkpoint.test.js` | (included in broader run) | Pass |
| `export.test.js` | (included in broader run) | Pass |
| `run-events.test.js` | (included in broader run) | Pass |
| **Total targeted** | **248** | **248/248 pass** |

Full suite deferred to QA.
