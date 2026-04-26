# BUG-84: Governance Report Fails with "Invalid string length"

## Purpose

Fix governance report generation that crashes with `RangeError: Invalid string length` on large continuous sessions, preventing auto-report output after governed runs complete.

## Root Cause

Two crash sites in `cli/src/commands/run.js:676-684`:

1. **Line 680**: `JSON.stringify(exportResult.export, null, 2)` — serializes the full export artifact (dispatch bundles, staging results, history, decision ledger, planning files, base64 content) into a single pretty-printed JSON string. For sessions with many turns, the accumulated dispatch bundle data (full prompts per turn) exceeds Node.js max string length (~268MB on V8 <12.x).

2. **Line 684**: `formatGovernanceReportMarkdown(reportResult.report)` — iterates over unbounded arrays (turns, governance events, decisions, gate failures, etc.) and joins them into a single string. Secondary crash site if per-section data is very large.

Both are caught by the try/catch at line 691, which logs the error and continues. The framework is not blocked — only report generation fails.

## Interface

No new public API. Internal changes only.

## Behavior

### Fix 1: Bounded export serialization (`run.js`)

- Remove pretty-print indent from export JSON: `JSON.stringify(export)` instead of `JSON.stringify(export, null, 2)`. Saves ~30-40% string size.
- Add a size-safe serialization path: try compact JSON first; if that throws RangeError, skip writing the export file and log a warning.
- Separate try/catch blocks for export file write vs report generation so a crash in one doesn't prevent the other.

### Fix 2: Bounded report sections (`report.js`)

- Add `MAX_REPORT_SECTION_ITEMS = 500` constant.
- Add `boundedSlice(arr, max)` utility that returns `{ items, omitted }`.
- Apply truncation in all three format functions (text, markdown, HTML) for arrays: turns, decisions, governance events, gate failures, gate actions, approval policy events, timeout events, intake links, delegation chains, workflow artifacts, coordinator timeline, barrier transitions, repo details.
- Append `(N more items omitted)` note when truncation occurs.
- Replace `+=` string concatenation loops in HTML formatter with `parts.push()` + `parts.join('')` for reduced memory pressure.

### Fix 3: Fallback report on overflow (`report.js`)

- Wrap each format function body in try/catch. If the full report throws RangeError, produce a minimal summary report (meta section only, no per-item sections) instead of propagating the error.

## Error Cases

- Export too large for JSON.stringify: skip export file, continue to report generation.
- Report format too large for string join: produce truncated summary report.
- Both fail: logged at `run.js:692`, non-blocking.

## Acceptance Tests

1. Report generation succeeds on a fixture with 500+ turns, 1000+ governance events. No RangeError thrown.
2. Sections with >500 items show "(N more items omitted)" in the output.
3. HTML formatter uses array.push pattern (no `+=` in loops).
4. Existing report tests continue to pass (no regression).
5. Fallback summary report is produced when format function would overflow.

## Open Questions

None — this is a non-blocking defect with clear fix boundaries.
