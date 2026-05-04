# Acceptance Matrix — M8: Control Plane API Design

**Run:** run_8140752664578eb2
**Turn:** turn_a6693ba4405f6667 (QA)
**Scope:** Control Plane API Design — OpenAPI 3.1 spec (29 operations), protocol bridge (15 exports + 5 error classes), schema compatibility tests (7 tests)

## Section A: SYSTEM_SPEC Acceptance Tests

| Req # | Requirement (from SYSTEM_SPEC §Acceptance Tests) | Evidence | Status |
|-------|------------------------------------------------------|----------|--------|
| AT-CP-SCHEMA-001 | OpenAPI spec is valid OpenAPI 3.1 | Test asserts `spec.openapi === '3.1.0'`, required top-level keys (`info`, `paths`, `components`, `securitySchemes`), global security requirement array, and every operation has `operationId`, `responses`, and `tags`. QA independently ran: 7/7 pass. | PASS |
| AT-CP-SCHEMA-002 | Every frozen-spec endpoint has a corresponding OpenAPI operation (29 operations) | Test asserts `operations.length === 29` and maps each of 29 `FROZEN_ENDPOINTS` entries by `method:path` to confirm matching `operationId`. QA verified `grep -c "operationId:" api/v1/control-plane.openapi.yaml` = 29. | PASS |
| AT-CP-SCHEMA-003 | Run response schema matches state.json structure | Test asserts Run schema has required fields `[id, proj_id, phase, status, turns, gates, decision_ledger, created_at, updated_at]`, `phase` enum includes `planning/implementation/qa`, `status` enum includes `active/completed`, `turns` is array, `gates` is object, `decision_ledger` is array. | PASS |
| AT-CP-SCHEMA-004 | Turn response schema matches history.jsonl entry structure | Test asserts Turn schema has required fields `[id, run_id, role, runtime_id, status, summary, files_changed, verification, artifact]`, `files_changed` is array, `verification` is object with `status` enum including `pass`, `artifact` is object with `type` enum including `workspace/commit`. | PASS |
| AT-CP-SCHEMA-005 | Decision response schema matches decision-ledger.jsonl entry structure | Test asserts Decision schema has required fields `[id, category, statement, rationale]`, `category` enum includes `implementation/architecture/scope`, and `id` has pattern referencing `DEC` prefix. | PASS |
| AT-CP-SCHEMA-006 | Protocol bridge exports cover all mutating API operations | Test dynamically imports `protocol-bridge.js` and asserts: 8 mutating functions (`createRun`, `cancelRun`, `acceptTurnResult`, `rejectTurnResult`, `approveTransition`, `checkpointTurn`, `retryTurn`, `exportRun`), 5 error classes (`ProtocolError`, `NotFoundError`, `ValidationError`, `AuthorizationError`, `ConflictError`), and 7 read functions (`getRunState`, `listRuns`, `getTurns`, `getTurn`, `getEvents`, `getDecisions`, `getGates`). Total: 15 functions + 5 error classes = 20 exports. | PASS |
| AT-CP-SCHEMA-007 | No governance-affecting fields in cloud-only metadata | Test verifies governance schemas (`Run`, `Turn`, `Decision`, `Gate`, `Event`) contain no cloud-only fields except the allowed set (`display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state`). Allowed fields must NOT be in `required` arrays. Pure governance schemas (`Decision`, `Gate`) must have zero cloud-only fields. `Run.display_name` exists but is nullable and not required. | PASS |

## Section B: Code Correctness Verification

| Check | Detail | Status |
|-------|--------|--------|
| OpenAPI spec structural completeness | 29 operations across 6 tags (tenancy=9, runs=5, turns=2, approvals=6, audit=4, webhooks=2). 12 component schemas. 2 security schemes (api_key X-API-Key header, bearer_auth JWT). 6 path parameters with ULID patterns. Cursor-based pagination on all list endpoints. 8 reusable error response components (400-500). `x-required-role` RBAC annotation on every operation. | PASS |
| Protocol bridge correctness | Imports verified against `runner-interface.js` (lines 27-50): `initRun`, `loadState`, `acceptTurn`, `rejectTurn`, `approvePhaseGate`, `markRunBlocked`, `reissueTurn`, `acquireLock`, `releaseLock`, `getTurnStagingResultPath` — all exist and match re-export aliases. Additional imports from `turn-checkpoint.js` (`checkpointAcceptedTurn`), `run-history.js` (`queryRunHistory`), `run-events.js` (`readRunEvents`), `export.js` (`buildRunExport`) — all verified to exist. | PASS |
| Error classification design | 5 typed error classes with distinct `code` properties. ProtocolError (generic state violations), NotFoundError (404 target + id), ValidationError (422), AuthorizationError (403 with role info), ConflictError (409 lock). HTTP server can deterministically map error.name → status code. | PASS |
| State-provider seam annotations | Every bridge function has `@state-provider` JSDoc documenting: what state file it reads/writes, what the cloud replacement would be. Verified 8 distinct seam annotations: `readState`, `writeState`, `readHistory`, `readEvents`, `readDecisions`, `acquireLock`, and inline descriptions. | PASS |
| Pagination implementation | Internal `paginate(items, cursor, limit)` helper: clamps limit to [1,100], parses cursor as integer index, returns `{data, cursor, has_more}`. Matches the `PaginatedList` schema in the OpenAPI spec exactly. | PASS |
| `restartRun` OpenAPI design-only marker | Endpoint exists in spec at `/v1/runs/{run_id}/restart` with description clearly noting "the protocol layer does not yet expose a restartFromCheckpoint primitive; this endpoint is design-only until the protocol adds it." Bridge correctly omits the function. | PASS |
| Vitest contract file count | `vitest-contract.test.js` asserts 668 test files. Test passes (11/11). | PASS |
| No existing source files modified | Only new files created: `api/v1/control-plane.openapi.yaml`, `cli/src/lib/api/protocol-bridge.js`, `cli/test/control-plane-schema.test.js`. Vitest contract and package.json/lock updated as expected. | PASS |

## Section C: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| control-plane-schema.test.js | 7 | PASS |
| vitest-contract.test.js | 11 | PASS |
| governed-state.test.js | 99 | PASS |
| runner-interface.test.js | 11 | PASS |
| run-events.test.js | 13 | PASS |
| **Targeted total (5 files)** | **141** | **0 failures** |

Full suite deferred (running at time of this report; 668 test files, expected ~7400+ tests based on prior runs).

## Section D: Dev Challenge

### DEC-001 (buildExportArtifact → buildRunExport): APPROVED

Dev correctly identified PM SYSTEM_SPEC §2.2 and §3.4 reference `buildExportArtifact` which does not exist. QA independently confirmed: `export.js:463` exports `buildRunExport(startDir, exportOpts)`. Bridge wraps the correct function. PM spec is inaccurate on this point.

### DEC-002 (restartFromCheckpoint does not exist): APPROVED

Dev correctly identified PM SYSTEM_SPEC §2.2 and §3.3 reference `restartFromCheckpoint` from `turn-checkpoint.js`. QA independently confirmed only `detectPendingCheckpoint` (line 304) and `checkpointAcceptedTurn` (line 344) are exported. No restart primitive exists in the protocol layer. Bridge correctly omits this function and the OpenAPI endpoint documents it as design-only. 15 exports (not PM's 16) is the correct count.

### DEC-003 (test file placement): APPROVED

Dev placed test at `cli/test/control-plane-schema.test.js` instead of PM-chartered `cli/test/api/control-plane-schema.test.js`. QA verified `vitest-contract.test.js` test-surface hygiene rule (line 108) only allows `fixtures` and `beta-tester-scenarios` directories in `cli/test/`. Dev's placement is correct — creating `api/` would fail hygiene.

## Section E: QA Findings

### OBJ-QA-001 (low): Dead import in protocol-bridge.js

`evaluatePhaseExit` is imported at line 38 from `'../gate-evaluator.js'` but never referenced in any function body. This is a minor code hygiene issue with no runtime impact (tree-shaking will remove it in bundled contexts, and Node.js ESM silently imports it).

### OBJ-QA-002 (medium): Dev overstated verification evidence

Dev's turn result claims "248 total tests across 7 targeted test files pass" but QA found:
- `turn-checkpoint.test.js` does not exist (no file in cli/test/ matching that name)
- `export.test.js` does not exist (only `export-cli.test.js`, `export-delegation-summary.test.js`, etc.)
- Actual count: 5 files, 141 tests

Vitest silently skips non-existent files specified on the CLI. The dev likely did not notice the 2 missing files. This does not affect correctness of the deliverables (all 7 acceptance tests still pass independently) but inflates the dev's evidence claims.
