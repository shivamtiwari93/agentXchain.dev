# Team Decisions

## DEC-001 - Use JSON output for CI
Status: accepted

### Context
CI pipelines need machine-readable output.

### Decision
Support a `--json` flag.

### Rationale
CI and local operator workflows both need deterministic parsing.

## DEC-002 - Keep status vocabulary narrow
Status: proposed

### Context
Loose status vocabularies make lint results inconsistent.

### Decision
Accept only `proposed`, `accepted`, `rejected`, and `superseded`.

### Rationale
This keeps the output deterministic and easy to explain.
