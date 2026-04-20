# Conformance Fixtures

This directory holds the current shipped AgentXchain protocol v7 conformance corpus.

Historical v2.2 conformance docs are retained elsewhere as superseded reference material. The fixture truth that implementors must match lives here, in `.planning/PROTOCOL_V7_SPEC.md`, and in `.planning/PROTOCOL_SPEC.md`.

## Layout

- `1/` Tier 1 core constitutional fixtures
- `2/` Tier 2 trust-hardening fixtures
- `3/` Tier 3 multi-repo coordination fixtures

Each fixture is a standalone JSON file under `<tier>/<surface>/`.

## Fixture-Layer Operations

These verbs are fixture abstractions, not CLI command names:

- `accept_turn` — accept a completed turn result into history
- `append_decision` — append a decision to the decision ledger
- `approve_completion` — human approves run completion
- `approve_transition` — human approves a phase transition gate
- `assign_turn` — assign a turn to a role
- `evaluate_phase_exit` — evaluate gate predicates for phase transition
- `evaluate_run_completion` — evaluate gate predicates for run completion
- `initialize_run` — create a new governed run
- `inspect_dispatch_manifest` — finalize a dispatch bundle and inspect manifest contents for structural invariants
- `project_repo_acceptance` — project a repo-local acceptance into coordinator state and evaluate barriers
- `resolve_blocked` — human resolves a blocked state
- `run_hooks` — execute a hook phase and return audit entries
- `transition_state` — perform a generic state transition
- `validate_config` — validate a governed config against schema
- `validate_coordinator_config` — validate a multi-repo coordinator config (`agentxchain-multi.json`)
- `validate_event` — validate one event entry in `.agentxchain/events.jsonl`
- `validate_event_ordering` — validate ordering and completeness of an event timeline
- `validate_turn_result` — run the staged turn-result validation pipeline
- `verify_dispatch_manifest` — finalize a dispatch bundle, apply declared post-finalize mutations, and verify integrity

The adapter is responsible for mapping these operations onto the target implementation.

## Setup Helpers

Not every surface uses every helper. These are the setup keys currently present in the shipped corpus:

### Common repo-local helpers

- `setup.config` — governed config JSON content to materialize before execution
- `setup.state` — run state JSON content to materialize before execution
- `setup.turn_result` — staged turn-result JSON content used by validation and acceptance fixtures
- `setup.history` — pre-existing accepted-turn history JSONL entries
- `setup.ledger` — pre-existing decision-ledger JSONL entries
- `setup.filesystem` — relative file paths mapped to UTF-8 content for gate predicates and file-based checks

### Dispatch-manifest helpers

- `setup.dispatch_bundle` — `{ turn_id: { filename: content } }` files to materialize before manifest operations
- `setup.post_finalize_inject` — `{ turn_id: { filename: content } }` files to add after manifest finalization
- `setup.post_finalize_tamper` — `{ turn_id: { filename: content } }` files to overwrite after manifest finalization
- `setup.post_finalize_delete` — `{ turn_id: [filenames] }` files to delete after manifest finalization
- `setup.post_finalize_corrupt_manifest` — `{ turn_id: string }` raw replacement content for `MANIFEST.json` after finalization
- `setup.post_finalize_delete_manifest` — `{ turn_id: true }` directive to remove `MANIFEST.json` after finalization

Manifest mutations are fixture data, not separate operations. Adapters own the finalize -> mutate -> verify sequence behind `verify_dispatch_manifest`.

### Coordinator helpers

- `setup.coordinator_config` — `agentxchain-multi.json` contents for Tier 3 fixtures
- `setup.repos` — `{ repo_id: { path, config, state, history, files } }` multi-workspace materialization map
- `setup.coordinator_state` — coordinator multirepo state JSON content
- `setup.barriers` — initial coordinator barrier snapshot
- `setup.coordinator_history` — coordinator history JSONL entries

Fixture setup is limited to repo-local state, staged artifacts, manifests, workflow files, and coordinator state required to exercise a fixture.

## Assertion Objects

The corpus currently uses this matcher vocabulary inside `expected`:

- `{ "assert": "nonempty_string" }` — value must be a non-empty string
- `{ "assert": "id_prefix", "value": "run_" }` — string starts with the required prefix
- `{ "assert": "id_prefix", "value": "proj_" }` — string starts with the required prefix
- `{ "assert": "present" }` — field must exist with any value
- `{ "assert": "unordered_array", "items": [...] }` — array contents must match the declared set without depending on order

`unordered_array` is currently used for multi-error dispatch-manifest assertions where multiple integrity violations must be reported together.

## Current Shipped Corpus

### Tier 1 — Expanded (77 fixtures)

| Surface | Count | IDs |
|---------|-------|-----|
| State Machine | 12 | `SM-001` through `SM-012` |
| Turn Result Validation | 10 | `TR-001` through `TR-010` |
| Gate Semantics | 16 | `GS-001` through `GS-016` |
| Decision Ledger | 4 | `DL-001` through `DL-004` |
| History | 3 | `HS-001` through `HS-003` |
| Config Schema | 5 | `CS-001` through `CS-005` |
| Delegation | 8 | `DEL-001` through `DEL-008` |
| Decision Carryover | 5 | `DC-001` through `DC-005` |
| Parallel Turns | 6 | `PT-001` through `PT-006` |
| Event Lifecycle | 8 | `EL-001` through `EL-008` |

### Tier 2 — Complete (23 fixtures)

| Surface | Count | IDs |
|---------|-------|-----|
| Dispatch Manifest | 10 | `DM-001` through `DM-010` |
| Hook Audit | 13 | `HA-001` through `HA-013` |

### Tier 3 — Expanded (8 fixtures)

| Surface | Count | IDs |
|---------|-------|-----|
| Coordinator | 8 | `CR-001` through `CR-008` |

Current Tier 3 proof covers:

- coordinator config validation
- `all_repos_accepted`
- `interface_alignment` via `decision_ids_by_repo`
- `named_decisions` via `named_decisions.decision_ids_by_repo`
- `ordered_repo_sequence`
- `shared_human_gate`
- cross-repo write isolation during acceptance projection

Total shipped corpus: **108 fixtures**.
