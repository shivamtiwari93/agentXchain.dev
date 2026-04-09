# System Spec

## Purpose

Provide a small CLI that keeps markdown decision logs auditable by detecting duplicate decision IDs, invalid statuses, and missing decision/rationale sections.

## Interface

- CLI command: `decision-log-linter lint <file> [--json]`
- Input: one markdown file containing decision entries headed by `## DEC-...`
- Output: human-readable lint summary or JSON payload
- Exit codes: `0` success, `1` lint failures, `2` usage or file-read failures

## Behavior

The parser scans for decision headings, groups each decision block, extracts `Status:`, and validates required sections for each decision entry. The linter returns every error in one pass so CI and operators do not need repeated reruns to uncover the next defect.

## Error Cases

- no decision entries found
- duplicate decision IDs
- invalid status token
- missing `Status:` line
- missing `### Decision`
- missing `### Rationale`
- invalid CLI command usage
- unreadable file path

## Acceptance Tests

- [x] Good fixture passes with exit code `0`
- [x] Bad fixture fails with exit code `1`
- [x] JSON output includes `ok`, `decisions_checked`, and `errors`
- [x] Duplicate IDs are reported by decision ID

## Open Questions

- Whether directory-wide linting belongs in this example is intentionally deferred.
