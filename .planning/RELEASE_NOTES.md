# Release Notes — M8: Control Plane API Design

## User Impact

This release delivers the **machine-readable API contract** for the agentxchain.ai control plane, proving that the existing governed execution protocol is composable by an HTTP server without modification.

### What Was Delivered

- **OpenAPI 3.1 Specification** (`api/v1/control-plane.openapi.yaml`): 29 operations across 6 resource groups (tenancy, runs, turns, approvals, audit, webhooks) with full request/response schemas, RBAC annotations (`x-required-role`), cursor-based pagination, typed error taxonomy (7 generic + 7 protocol-specific error codes), and 2 authentication schemes (API key, JWT bearer).

- **Protocol Bridge Module** (`cli/src/lib/api/protocol-bridge.js`): 15 exported functions wrapping `runner-interface.js` primitives for HTTP consumption, plus 5 typed error classes (`ProtocolError`, `NotFoundError`, `ValidationError`, `AuthorizationError`, `ConflictError`). Every filesystem operation is annotated with `@state-provider` seam documentation for future cloud storage replacement.

- **Schema Compatibility Tests** (`cli/test/control-plane-schema.test.js`): 7 tests validating the API contract against protocol state shapes (Run ↔ state.json, Turn ↔ history.jsonl, Decision ↔ decision-ledger.jsonl), endpoint coverage (29 operations), bridge export completeness, and cloud-only field governance isolation.

### Architecture Highlights

- **No HTTP objects** in the bridge — pure protocol-to-protocol adapter. HTTP request/response mapping is the server's responsibility.
- **Cursor-based pagination** on all list endpoints (no offset pagination — reliable with append-only event streams).
- **Design-only restart endpoint** — the OpenAPI spec includes `POST /v1/runs/{run_id}/restart` for API completeness, but the protocol layer does not yet expose a restart primitive. The bridge will add it when the protocol does.
- **12 component schemas** match protocol state shapes exactly — no cloud-only fields affect governance.

### What This Enables (Future Work)

This is the foundation for ROADMAP.md items :95-:98:
- HTTP server implementation (wraps the bridge)
- Cloud persistence layer (replaces `@state-provider` seams)
- Dashboard UI (consumes the API)
- Execution plane workers (use the API for run management)

## Verification Summary

- All 7 AT-CP-SCHEMA acceptance tests pass (independently verified by QA)
- Vitest contract: 11/11 pass (file count = 668)
- Targeted protocol regression suite: 141 tests across 5 files, 0 failures
- No whitespace issues (`git diff --check` clean)
- OpenAPI operation count independently verified: 29
- Protocol bridge imports verified against runner-interface.js, turn-checkpoint.js, run-history.js, run-events.js, gate-evaluator.js, export.js — all exist
