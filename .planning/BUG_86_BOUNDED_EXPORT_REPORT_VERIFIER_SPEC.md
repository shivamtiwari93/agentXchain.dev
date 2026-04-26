# BUG-86: Bounded Export Report Verifier

## Purpose

`agentxchain run` must be able to generate governance reports from bounded exports created for large dogfood sessions. BUG-84 bounded export size by allowing selected file entries to omit raw `content_base64`, but the report verifier still rejected those bounded entries as invalid.

## Interface

- `buildRunExport(root, { maxJsonlEntries, maxBase64Bytes })` may emit file entries with:
  - `content_base64: null`
  - `truncated: true` for windowed JSONL entries, or
  - `content_base64_skipped: true` for files over the raw-byte cap.
- `buildGovernanceReport(exportArtifact)` must accept those bounded entries when the skip markers and parsed `data` shape are coherent.
- `agentxchain report --input <export.json>` must return exit code `0` for coherent bounded exports.

## Behavior

1. Full file entries with string `content_base64` keep strict byte/hash/data verification.
2. Bounded file entries with `content_base64: null` are accepted only when explicitly marked as `truncated` or `content_base64_skipped`.
3. Truncated entries are only valid for JSONL files and must include coherent `total_entries`, `retained_entries`, and array `data`.
4. Byte-skipped entries must still include format-appropriate parsed `data`:
   - `json`: object/array/string/number/bool/null JSON value
   - `jsonl`: array
   - `text`: string
5. Bounded entries are never restored or replayed as raw bytes; this spec only covers report verification.

## Error Cases

- `content_base64: null` without `truncated` or `content_base64_skipped` remains invalid.
- `truncated: true` on non-JSONL entries remains invalid.
- Malformed truncation metadata remains invalid.
- Non-null non-string `content_base64` remains invalid.

## Acceptance Tests

- A run export with truncated `.agentxchain/events.jsonl` builds a passing governance report.
- A run export with a byte-skipped text/log file builds a passing governance report.
- `agentxchain report --input <bounded-export.json> --format markdown` exits `0` and does not print `content_base64 must be a string`.
- A file entry with `content_base64: null` and no skip marker still fails verification.

## Open Questions

- Should future restore/replay commands refuse bounded exports earlier with a clearer "not restorable" diagnostic? Current restore behavior already requires raw `content_base64`, which is correct for byte-for-byte replay.
