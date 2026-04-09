# Decision Log Linter Collaboration Log

## Turn 1

- PM constrained scope to a single-file markdown linter with honest exit codes.
- Architecture required deterministic parsing and JSON output for CI use.
- Dev implemented the parser, linter, CLI wrapper, and tests.
- QA required negative fixtures for duplicate IDs, invalid statuses, and missing rationale sections.
- Release scope stayed repo-local: package metadata, smoke command, and distribution checklist.
