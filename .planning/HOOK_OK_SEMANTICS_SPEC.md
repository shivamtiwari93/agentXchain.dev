# Hook Audit Response Contract — `hook_ok` Semantics

**Status:** Current
**Author:** Claude Opus 4.6
**Date:** 2026-04-04
**Scope:** Documentation of `hook_ok` field semantics in the hook_audit conformance surface

## Purpose

The `hook_audit` conformance surface exposes a `hook_ok` boolean in every fixture response. This field is consumed by 13 Tier 2 fixtures, set by the reference adapter (`reference-conformance-adapter.js:803`), and produced by `runHooks()` in `hook-runner.js` as the `.ok` return field. Despite being a core conformance field, `hook_ok` is **not documented anywhere in the public docs surface**. The implementor guide's `hook_audit` section is 2 lines of prose with no field reference.

This spec defines the documentation contract.

## Decision: Documentation, Not Schema Expansion

**`hook_ok` is kept as-is. No `hook_succeeded` field is added.**

Rationale:

1. **The disambiguation signal already exists.** `orchestrator_action` is a precise 13-value enum that tells you exactly what happened: `continued`, `warned`, `blocked`, `blocked_failure`, `blocked_timeout`, `blocked_invalid_output`, `warned_failure`, `warned_timeout`, `warned_invalid_output`, `downgraded_block_to_warn`, `aborted_tamper`, `skipped`, `blocked` (explicit verdict). Adding a boolean that partially overlaps this enum is redundant protocol surface.

2. **Adding `hook_succeeded` would touch 13 fixtures, the adapter, hook-runner.js, and every third-party implementation.** The value/cost ratio is poor for a field that duplicates information already available in `orchestrator_action`.

3. **The real gap is documentation, not schema.** An implementor reading the guide today has zero information about what `hook_ok` means or what response shape to return from a `run_hooks` operation. Fixing that gap is higher value than adding a second boolean.

4. **`hook_ok` is not misleading when documented.** "Can the governed pipeline proceed?" is a clear, useful signal. It is misleading only when undocumented and operators infer "did the hook succeed?" from the name.

## Interface — Hook Audit Response Shape

The `run_hooks` operation in the conformance adapter must return:

```json
{
  "result": "success",
  "hook_ok": boolean,
  "blocked": boolean,
  "audit_entry": { ... } | null,
  "audit_entries": [ ... ]
}
```

### `hook_ok` (boolean)

**Semantics: "Can the governed pipeline proceed past this hook phase?"**

- `true`: No blocking condition was encountered. Execution continues. This includes advisory hooks that failed, timed out, or produced invalid output — advisory failures degrade to warnings but do not halt the pipeline.
- `false`: The pipeline is halted. Either a blocking hook blocked (via verdict, failure, timeout, or invalid output), or protected-file tamper was detected.

### `blocked` (boolean)

- `true`: A blocking hook returned `verdict: "block"` (explicit, fail-closed failure, timeout, or invalid output). A `blocker` object exists with `hook_name`, `verdict`, and `message`.
- `false`: Either no blocking occurred, or the halt was caused by tamper detection (which is a different halt mechanism — tamper returns `ok: false, blocked: false` with a `tamper` object instead).

### `audit_entry` (object | null)

The first entry in `audit_entries`. Provided for backward compatibility with single-hook fixtures. New fixtures should use `audit_entries`.

### `audit_entries` (array)

Ordered list of all hook execution results for this phase. Each entry contains:

| Field | Type | Description |
|---|---|---|
| `hook_name` | string | Name of the hook definition |
| `hook_phase` | string | Lifecycle phase |
| `transport` | string | `"process"` or `"http"` (absent on skipped entries) |
| `verdict` | string \| null | `"allow"`, `"warn"`, `"block"`, or `null` (tamper/skipped) |
| `orchestrator_action` | string | One of 13 values — the precise execution outcome |
| `exit_code` | number \| null | Process exit code (null for HTTP or skipped) |
| `timed_out` | boolean | Whether the hook exceeded `timeout_ms` |
| `duration_ms` | number | Execution time (0 for skipped) |
| `message` | string \| null | Verdict message or error description |
| `annotations` | array | Hook-provided annotations (after_acceptance phase only) |
| `stderr_excerpt` | string | Truncated stderr (empty for skipped/HTTP) |

### `orchestrator_action` Values

| Value | `hook_ok` | `blocked` | When |
|---|---|---|---|
| `continued` | `true` | `false` | Hook returned `verdict: "allow"` |
| `warned` | `true` | `false` | Hook returned `verdict: "warn"` |
| `downgraded_block_to_warn` | `true` | `false` | Advisory hook returned `verdict: "block"` (downgraded) |
| `warned_failure` | `true` | `false` | Advisory hook exited non-zero |
| `warned_timeout` | `true` | `false` | Advisory hook exceeded timeout |
| `warned_invalid_output` | `true` | `false` | Advisory hook produced unparseable stdout |
| `blocked` | `false` | `true` | Blocking hook returned `verdict: "block"` |
| `blocked_failure` | `false` | `true` | Blocking hook exited non-zero (fail-closed) |
| `blocked_timeout` | `false` | `true` | Blocking hook exceeded timeout (fail-closed) |
| `blocked_invalid_output` | `false` | `true` | Blocking hook produced unparseable stdout (fail-closed) |
| `aborted_tamper` | `false` | `false` | Hook modified a SHA-256 protected file |
| `skipped` | `false` | `true` | Prior blocking hook blocked; remaining hooks skipped |

Note: `skipped` entries appear in `audit_entries` but not as the primary `audit_entry`. They have `verdict: null`, `exit_code: null`, `duration_ms: 0`, and no `transport` field.

## Error Cases

None — this is a documentation spec, not a new feature.

## Acceptance Tests

1. The protocol implementor guide must contain a `hook_audit` subsection that documents `hook_ok`, `blocked`, `audit_entry`, `audit_entries`, and `orchestrator_action`.
2. The `hook_ok` documentation must state "pipeline can proceed" semantics, not "hook succeeded."
3. All 13 `orchestrator_action` values must appear in the docs.
4. The docs must be code-backed: guard reads `orchestrator_action` values from `hook-runner.js` and verifies they appear in the implementor guide.
5. The `hook_ok` × `blocked` truth table must be present and match the implementation.

## Open Questions

1. Whether `hook_ok` should eventually be renamed to `pipeline_ok` or `execution_can_proceed` in a future protocol version. This spec does NOT propose a rename — it documents the current field truthfully. A rename would be a protocol-breaking change requiring a version bump.
