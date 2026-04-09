# Roadmap

## Goal

Ship a CLI that can be dropped into CI to keep markdown decision logs structurally honest.

## Phases

1. Planning
2. Architecture
3. Implementation
4. QA
5. Release

## Delivery Slice

- parse markdown decision entries
- lint structural defects
- support human-readable and JSON output
- verify behavior with fixture-driven tests

## Acceptance Criteria

- Good fixture exits `0`
- Bad fixture exits `1`
- JSON mode returns machine-readable errors
- Duplicate IDs are rejected
- Missing `Status:`, `### Decision`, or `### Rationale` is rejected
