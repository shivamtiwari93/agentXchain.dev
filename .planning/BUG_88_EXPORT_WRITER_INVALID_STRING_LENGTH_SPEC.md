# BUG-88: Export Writer Invalid String Length on Large Accumulated State

## Purpose

Fix the governance export writer crash (`Invalid string length`) that occurs when `JSON.stringify()` is called on export objects that exceed Node.js's maximum string length. The crash prevents fresh exports from being produced for large dogfood sessions, causing report generation to silently fall back to stale exports.

## Root Cause

`run.js:683` calls `JSON.stringify(exportResult.export)` on the full export object. For large accumulated state:

1. `.planning/` can contain 788+ markdown/JSON files.
2. Each file is represented twice: as `content_base64` (base64-encoded) and `data` (parsed text/JSON).
3. `.agentxchain/dispatch/` and `.agentxchain/staging/` grow linearly with turn count.
4. No aggregate size limit exists on the export object.
5. Combined, these can exceed Node.js's `String.MAX_LENGTH` (~512MB) during serialization.

BUG-84 bounded the report *formatter* arrays (sections capped at 500 items). BUG-86 made the verifier accept bounded exports. Neither bounds the export *writer* itself.

## Fix Design

### Layer 1: Pre-bound the export object

Add two new options to `buildRunExport()`:

- `maxExportFiles` (default 500): Cap total files collected. Core governance files (state, events, history, decision-ledger, hook-audit, config) are collected first. Dispatch, staging, and transaction files are next. `.planning/` files are collected last and are the first to be trimmed.
- `maxTextDataBytes` (default 131072 / 128KB): Text files (`.md`, `.txt`) with content exceeding this threshold get `data` truncated to the first `maxTextDataBytes` characters with `truncated: true` marker.

In `parseFile()`, when `opts.maxTextDataBytes` is set and the text data string exceeds it, truncate:
```javascript
if (data.length > opts.maxTextDataBytes) {
  data = data.slice(0, opts.maxTextDataBytes);
  truncated = true;
}
```

### Layer 2: Fallback-safe serialization in run.js

Wrap `JSON.stringify()` in a two-attempt pattern:
1. First attempt: normal serialization with default bounds.
2. On `Invalid string length` catch: re-run `buildRunExport()` with tighter bounds (`maxExportFiles: 200`, `maxTextDataBytes: 32768`, `maxBase64Bytes: 65536`) and retry serialization.
3. If the tight-bound attempt also fails, log the failure and continue to report generation from the in-memory export (skip disk write).

### Layer 3: Stale-export-fallback surfacing

When the export write to disk fails but report generation proceeds from the in-memory export object:
- Add `export_source: 'in_memory'` to the report metadata (vs `export_source: 'disk'` for normal).
- Log a clear message: `Governance export exceeded disk-write limits; report generated from in-memory bounded export.`

When no fresh export is available at all and report falls back to a previous on-disk export:
- Add `stale_export_fallback: true` and `stale_export_timestamp` to the report.
- Log: `Report generated from stale export (timestamp). Fresh export write failed.`

## Behavior

- Normal sessions (< 500 files, text files < 128KB): no change.
- Large sessions: export is bounded, written to disk, report generated from fresh bounded export.
- Very large sessions (tight bounds still too big): report generated from in-memory bounded export; disk write skipped with explicit log.
- BUG-84 `boundedSlice` remains in report formatters (defense-in-depth).
- BUG-86 bounded verifier semantics preserved (accepts `content_base64: null` with markers).

## Acceptance Tests

1. Export with 600+ files: completes without `Invalid string length`, export file written to disk.
2. Export with large text files (> 128KB each): text data truncated, `truncated: true` set.
3. Stale-fallback never silent: when fresh export write fails, report includes `export_source` or `stale_export_fallback` metadata.
4. BUG-84 regression: report formatters still cap at 500 items.
5. BUG-86 regression: verifier accepts bounded exports with `content_base64: null`.

## Error Cases

- `JSON.stringify` throws `Invalid string length`: caught, tight-bound retry, fallback to in-memory.
- Empty `.planning/` directory: export succeeds with 0 `.planning/` files.
- File read errors: existing `parseFile` error handling preserved.
