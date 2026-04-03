# Conformance Fixtures

This directory holds the v2.2 protocol conformance corpus.

## Layout

- `1/` Tier 1 core constitutional fixtures
- `2/` Tier 2 trust-hardening fixtures
- `3/` Tier 3 multi-repo fixtures

Each fixture is a standalone JSON file under `<tier>/<surface>/`.

## Fixture-Layer Operations

These verbs are fixture abstractions, not CLI command names:

- `initialize_run`
- `assign_turn`
- `approve_transition`
- `approve_completion`
- `resolve_blocked`
- `transition_state`

The adapter is responsible for mapping these operations onto the target implementation.

## Assertion Objects

The initial corpus uses a minimal matcher vocabulary inside `expected`:

- `{ "assert": "nonempty_string" }`
- `{ "assert": "id_prefix", "value": "run_" }`
- `{ "assert": "present" }`

## Authoring Status

Fixture authoring has started with Tier 1 state-machine coverage. Remaining Tier 1 surfaces should be completed before validator implementation begins.
