# Architecture

## Context

The tool should stay dependency-free so the example remains easy to run inside a governed repo and straightforward to audit.

## Proposed Design

- `src/parser.js` extracts decision blocks from markdown headings.
- `src/lint.js` applies structural rules and returns normalized error objects.
- `src/index.js` owns CLI argument parsing, file I/O, formatting, and exit codes.
- `bin/decision-log-linter.js` is the executable wrapper.

## Trade-offs

- Single-file input only in v0.1.0 keeps parsing and error reporting simple.
- Markdown heuristics are intentionally narrow; this tool validates one opinionated decision-log shape, not every markdown ADR format.

## Risks

- Overly permissive heading parsing could accept malformed decision IDs.
- Overly strict status rules could reject legitimate team vocabularies.
- JSON output drift would make CI integration brittle.
