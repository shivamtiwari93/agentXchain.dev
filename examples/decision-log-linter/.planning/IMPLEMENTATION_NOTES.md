# Implementation Notes

## Changes

- Implemented a dependency-free parser for `## DEC-*` entries.
- Added lint rules for duplicate IDs, missing `Status:`, invalid status values, and missing `### Decision` / `### Rationale`.
- Added a CLI wrapper with human-readable and JSON output modes.
- Added fixture-driven tests for parser behavior, lint failures, and CLI exit codes.

## Verification

- `node --test`
- `node ./bin/decision-log-linter.js lint ./test/fixtures/good.md`
- `node ./bin/decision-log-linter.js lint ./test/fixtures/bad.md --json`
