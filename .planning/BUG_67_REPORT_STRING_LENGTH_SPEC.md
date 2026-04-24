# BUG-67: Report Generation "Invalid string length" Crash

## Purpose

Prevent V8 `Invalid string length` crashes when auto-generating governance reports after governed runs that accumulate many turns.

## Root Cause

After a governed run, `run.js` auto-generates a governance report by calling `buildRunExport()` which reads **all** JSONL files (`events.jsonl`, `history.jsonl`, `decision-ledger.jsonl`) entirely into memory, parses them into arrays, AND base64-encodes the raw content. With many turn attempts (65+ dispatches in the tusq.dev dogfood), these files grow large enough that `JSON.stringify()` on the combined export object exceeds V8's ~512MB string limit.

The crash chain:
1. `parseFile()` reads entire file via `readFileSync` → `buffer.toString('utf8')` → parses into array
2. Same buffer → `buffer.toString('base64')` (33% size inflation)
3. Export object contains BOTH parsed `data` arrays AND `content_base64` strings for every file
4. `JSON.stringify(exportResult.export, null, 2)` tries to serialize everything into one string → crash

## Fix

### `parseFile()` in `export.js`

Accepts optional `opts`:
- `maxJsonlEntries`: when set and JSONL entry count exceeds this, keep only the **tail** (most recent) entries. Mark `truncated: true`, `total_entries`, `retained_entries` on the returned object.
- `maxBase64Bytes`: when set and file size exceeds this, skip `content_base64` (set to `null`). Mark `content_base64_skipped: true`.

### `buildRunExport()` in `export.js`

Accepts optional second parameter `exportOpts` and propagates `maxJsonlEntries` and `maxBase64Bytes` to `parseFile()`. Default behavior (no opts) is unchanged — full export for the CLI `export` command.

### Auto-report path in `run.js`

Passes `{ maxJsonlEntries: 1000, maxBase64Bytes: 1024 * 1024 }` to `buildRunExport()`. This caps auto-report JSONL data to the last 1000 entries and skips base64 for files over 1MB.

## Behavior

| Scenario | Before | After |
|---|---|---|
| Auto-report with <1000 events | Full export, report generated | Same — no truncation |
| Auto-report with 5000 events | `Invalid string length` crash | Last 1000 events, report generated with truncation note |
| CLI `agentxchain export` | Full export | Same — no limits applied |
| CLI `agentxchain report` | Full export → report | Same — no limits (report reads piped export) |

## Acceptance Tests

1. `parseFile()` with JSONL exceeding `maxJsonlEntries` returns truncated tail with metadata
2. `parseFile()` with large file and `maxBase64Bytes` skips base64
3. `parseFile()` without options returns full data (backward compatibility)
4. `buildRunExport()` with `maxJsonlEntries` propagates to parsed files
