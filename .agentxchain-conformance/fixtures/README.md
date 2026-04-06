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
- `evaluate_run_completion` — evaluate gate predicates for run completion
- `append_decision` — append a decision to the decision ledger
- `validate_config` — validate a governed config against schema
- `verify_dispatch_manifest` — finalize a dispatch bundle, apply declared post-finalize mutations, and verify integrity
- `inspect_dispatch_manifest` — finalize a dispatch bundle and inspect manifest contents for structural invariants
- `run_hooks` — execute hook phase and return audit entry
- `validate_coordinator_config` — validate a multi-repo coordinator config (agentxchain-multi.json)
- `project_repo_acceptance` — project a repo-local acceptance into coordinator state and evaluate barriers

The adapter is responsible for mapping these operations onto the target implementation.

## Setup Helpers

- `setup.filesystem` is a map of relative file paths to UTF-8 file contents the adapter must materialize before executing the fixture.
- `setup.dispatch_bundle` is a map of `{ turn_id: { filename: content } }` to materialize dispatch bundle files before manifest operations.
- `setup.post_finalize_inject` is a map of `{ turn_id: { filename: content } }` to inject unexpected files after manifest finalization.
- `setup.post_finalize_tamper` is a map of `{ turn_id: { filename: content } }` to overwrite files after manifest finalization.
- `setup.post_finalize_delete` is a map of `{ turn_id: [filenames] }` to delete files after manifest finalization.
- Manifest mutations are fixture data, not separate operations. Adapters own the finalize → mutate → verify sequence behind `verify_dispatch_manifest`.
- Fixture setup is limited to repo-local state, ledger/history files, staged turn results, dispatch bundles, and text files required for gate predicates.
- `setup.coordinator_config` is the `agentxchain-multi.json` contents for Tier 3 multi-repo fixtures.
- `setup.repos` is a map of `{ repo_id: { path, config, state, history, files } }` for Tier 3 multi-workspace materialization.
- `setup.coordinator_state` is the coordinator multirepo state for Tier 3 fixtures.
- `setup.barriers` is the initial barrier snapshot for Tier 3 fixtures.
- `setup.coordinator_history` is the coordinator history JSONL entries for Tier 3 fixtures.

## Assertion Objects

The corpus uses a minimal matcher vocabulary inside `expected`:

- `{ "assert": "nonempty_string" }` — value must be a non-empty string
- `{ "assert": "id_prefix", "value": "run_" }` — string starts with prefix
- `{ "assert": "present" }` — field must exist (any value)

## Authoring Status

### Tier 1 — Complete (46 fixtures)

| Surface | Count | IDs |
|---------|-------|-----|
| State Machine | 12 | SM-001 through SM-012 |
| Turn Result Validation | 10 | TR-001 through TR-010 |
| Gate Semantics | 12 | GS-001 through GS-012 |
| Decision Ledger | 4 | DL-001 through DL-004 |
| History | 3 | HS-001 through HS-003 |
| Config Schema | 5 | CS-001 through CS-005 |

### Tier 2 — Complete (23 fixtures)

| Surface | Count | IDs |
|---------|-------|-----|
| Dispatch Manifest | 10 | DM-001 through DM-010 |
| Hook Audit | 13 | HA-001 through HA-013 |

### Tier 3 — Complete (5 fixtures)

| Surface | Count | IDs |
|---------|-------|-----|
| Coordinator | 5 | CR-001 through CR-005 |
