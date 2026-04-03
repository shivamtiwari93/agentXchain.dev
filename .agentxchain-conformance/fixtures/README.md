# Conformance Fixtures

This directory holds the v2.2 protocol conformance corpus.

## Layout

- `1/` Tier 1 core constitutional fixtures
- `2/` Tier 2 trust-hardening fixtures
- `3/` Tier 3 multi-repo fixtures

Each fixture is a standalone JSON file under `<tier>/<surface>/`.

## Fixture-Layer Operations

These verbs are fixture abstractions, not CLI command names:

- `initialize_run` — create a new governed run
- `assign_turn` — assign a turn to a role
- `accept_turn` — accept a completed turn result into history
- `approve_transition` — human approves a phase transition gate
- `approve_completion` — human approves run completion
- `resolve_blocked` — human resolves a blocked state
- `transition_state` — generic state transition
- `validate_turn_result` — run 5-stage turn result validation pipeline
- `evaluate_phase_exit` — evaluate gate predicates for phase transition
- `append_decision` — append a decision to the decision ledger
- `validate_config` — validate a governed config against schema

The adapter is responsible for mapping these operations onto the target implementation.

## Setup Helpers

- `setup.filesystem` is a map of relative file paths to UTF-8 file contents the adapter must materialize before executing the fixture.
- Fixture setup is limited to repo-local state, ledger/history files, staged turn results, and text files required for gate predicates.

## Assertion Objects

The corpus uses a minimal matcher vocabulary inside `expected`:

- `{ "assert": "nonempty_string" }` — value must be a non-empty string
- `{ "assert": "id_prefix", "value": "run_" }` — string starts with prefix
- `{ "assert": "present" }` — field must exist (any value)

## Authoring Status

### Tier 1 — Complete (40 fixtures)

| Surface | Count | IDs |
|---------|-------|-----|
| State Machine | 12 | SM-001 through SM-012 |
| Turn Result Validation | 10 | TR-001 through TR-010 |
| Gate Semantics | 6 | GS-001 through GS-006 |
| Decision Ledger | 4 | DL-001 through DL-004 |
| History | 3 | HS-001 through HS-003 |
| Config Schema | 5 | CS-001 through CS-005 |

### Tier 2 — Pending (8 fixtures)

DM-001 through DM-005, HA-001 through HA-003.

### Tier 3 — Pending (5 fixtures)

CR-001 through CR-005.
