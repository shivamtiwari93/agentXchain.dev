# Export Schema Reference Spec

**Status:** shipped
**Slice:** operator-facing export artifact contract
**Created:** Turn 22 — GPT 5.4

## Purpose

Document the real machine contract produced by `agentxchain export` and consumed by `agentxchain verify export`.

The exporter and verifier already enforce a stable JSON schema, but that truth lives only in implementation code and test assertions. That is not good enough for operators building automation around exported audit artifacts. They need one public reference surface that names the fields, the two export kinds, the nested coordinator contract, and the file-entry integrity model without forcing them to read `cli/src/lib/export.js`.

## Scope Boundary

### In scope

- A dedicated public docs page for the export artifact schema
- Both `agentxchain_run_export` and `agentxchain_coordinator_export`
- File-entry contract: `format`, `bytes`, `sha256`, `content_base64`, `data`
- Summary-field semantics for run and coordinator artifacts
- Explicit distinction between raw coordinator snapshot fields and downstream operator-facing comparison/report truth
- Explicit distinction between export-time summary metadata and richer downstream report surfaces
- Child-repo embedding and failure contract for coordinator exports
- Explicit statement that export artifacts are a stable operator contract, not protocol v7 conformance
- Code-backed docs guard built from actual exporter and verifier behavior

### Out of scope

- Changing the exporter schema
- New export formats
- Detached signatures, attestations, or encryption
- Promoting export artifacts into protocol v7 conformance

## Interface

Public docs surfaces:

- `/docs/export-schema`
- `/docs/cli` export section cross-link
- `/docs/protocol-reference` boundary clarification

## Behavior

### Boundary

- Export artifacts are a stable operator-facing inspection contract.
- They are not protocol v7 conformance surfaces.
- The protocol reference page must say that directly and link to the export schema page instead of blurring the boundary.

### Run export contract

The docs must cover the real top-level keys emitted by `buildRunExport()`:

- `schema_version`
- `export_kind`
- `exported_at`
- `project_root`
- `project`
- `summary`
- `files`
- `config`
- `state`

The docs must cover the real nested `project` and `summary` fields, including:

- `project.id`, `project.name`, `project.template`, `project.protocol_mode`, `project.schema_version`
- `summary.run_id`, `summary.status`, `summary.phase`
- `summary.active_turn_ids`, `summary.retained_turn_ids`
- `summary.history_entries`, `summary.decision_entries`
- `summary.hook_audit_entries`, `summary.notification_audit_entries`
- `summary.dispatch_artifact_files`, `summary.staging_artifact_files`
- `summary.intake_present`, `summary.coordinator_present`
- `summary.dashboard_session` as an export-time local snapshot validated for schema/invariants only, not live daemon truth
- `summary.delegation_summary` as a derived convenience summary reconstructed from embedded history, not an independent authority ledger

### Coordinator export contract

The docs must cover the real top-level keys emitted by `buildCoordinatorExport()`:

- `schema_version`
- `export_kind`
- `exported_at`
- `workspace_root`
- `coordinator`
- `summary`
- `files`
- `config`
- `repos`

The docs must cover:

- `coordinator.project_id`, `project_name`, `schema_version`, `repo_count`, `workstream_count`
- `summary.super_run_id`, `status`, `phase`, `repo_run_statuses`, `barrier_count`, `history_entries`, `decision_entries`
- `repos.<repo_id>.ok`, `path`, `export`, and `error`
- `summary.repo_run_statuses` as the raw coordinator-state snapshot, not the operator-facing repo-status authority for report/audit/diff when nested child exports are readable

### File-entry integrity contract

Every included file entry must be documented with:

- `format`
- `bytes`
- `sha256`
- `content_base64`
- `data`

The docs must explain that `verify export` re-derives `bytes` and `sha256` from `content_base64`, then validates `data` against decoded JSON, JSONL, or text content.

## Error Cases

1. The docs blur export schema with protocol v7 conformance
2. The docs omit coordinator child-repo failure semantics
3. The docs omit real top-level or nested keys
4. The docs blur raw coordinator snapshot metadata with downstream operator-facing report/diff truth
5. The docs blur export-time metadata with live downstream report behavior
6. The docs claim fields or behaviors not emitted by exporter/verifier code

## Acceptance Tests

- `AT-EXPORT-REF-001`: `/docs/export-schema` exists and is wired into docs navigation
- `AT-EXPORT-REF-002`: the page states export artifacts are an operator contract, not protocol v7 conformance
- `AT-EXPORT-REF-003`: the page documents the actual run export top-level, project, summary, and file-entry keys emitted by `buildRunExport()`
- `AT-EXPORT-REF-004`: the page documents the actual coordinator export top-level, coordinator, summary, and per-repo keys emitted by `buildCoordinatorExport()`
- `AT-EXPORT-REF-005`: the page documents the real child-repo failure contract (`ok: false` plus `error`) without claiming coordinator export failure
- `AT-EXPORT-REF-006`: `/docs/protocol-reference` links to the export schema page and keeps the non-normative boundary explicit
- `AT-EXPORT-REF-007`: the page documents `summary.aggregated_events` verification against embedded child-repo `events.jsonl`
- `AT-EXPORT-REF-008`: the page distinguishes raw coordinator `summary.repo_run_statuses` snapshot metadata from the authority-first repo-status contract used by report/audit/diff when nested child exports are readable
- `AT-EXPORT-REF-009`: the page distinguishes `summary.dashboard_session` as export-time local snapshot metadata and `summary.delegation_summary` as history-derived summary metadata, instead of implying either field is an independent live authority surface

## Open Questions

None in this slice. Schema expansion belongs to a future export-format or attestation slice, not this documentation closure.
