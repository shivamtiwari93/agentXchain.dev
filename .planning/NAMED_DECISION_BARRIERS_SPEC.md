# Named Decision Barriers Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-14

## Purpose

Generalize coordinator decision-gated synchronization beyond the narrow `interface_alignment` label.

Today the coordinator can require specific `DEC-NNN` IDs only through `interface_alignment`. That is too specific. Many cross-repo checkpoints are not interface-alignment problems; they are named governance decisions that must exist before the workstream may advance.

This slice adds a first-class `named_decisions` completion barrier so operators can declare decision checkpoints honestly.

## Interface

New coordinator barrier type:

```json
{
  "completion_barrier": "named_decisions",
  "named_decisions": {
    "decision_ids_by_repo": {
      "api": ["DEC-101"],
      "web": ["DEC-201", "DEC-202"]
    }
  }
}
```

Rules:

- `completion_barrier: "named_decisions"` requires `named_decisions.decision_ids_by_repo`
- every repo in `workstream.repos` must declare a non-empty decision ID array
- every decision ID must match `DEC-NNN`
- duplicates are rejected per repo
- undeclared repos are rejected

Barrier snapshot contract in `.agentxchain/multirepo/barriers.json`:

- `required_decision_ids_by_repo`
- `satisfied_repos`

Backward compatibility:

- existing `interface_alignment` configs continue to work
- `interface_alignment` and `named_decisions` share the same decision-requirement evaluation path
- cross-repo context surfaces required decision IDs for either barrier type

## Behavior

### Barrier evaluation

- The barrier is `pending` before any required repo has accepted its declared decision IDs.
- The barrier is `partially_satisfied` when at least one required repo has accepted all declared decision IDs but not all required repos have done so.
- The barrier is `satisfied` when every required repo has accepted all declared decision IDs.
- Plain repo acceptance without the declared decision IDs does not satisfy the barrier.

### Context surfacing

- `COORDINATOR_CONTEXT.json` includes `required_decision_ids_by_repo` for active `named_decisions` barriers.
- `COORDINATOR_CONTEXT.md` renders `Required decision IDs for <repo>: ...` for the target repo.
- Required follow-ups include `Accept declared decision requirements for <repo>: ...`.

## Error Cases

- `named_decisions` barrier declared without `named_decisions.decision_ids_by_repo`
- missing decision requirements for one or more repos in the workstream
- invalid decision ID format
- duplicate decision ID within one repo declaration
- undeclared repo key inside `decision_ids_by_repo`

## Acceptance Tests

- `AT-NDB-001`: config validation accepts `named_decisions` only when `decision_ids_by_repo` is declared for every repo
- `AT-NDB-002`: barrier stays unsatisfied until each repo accepts the declared decision IDs
- `AT-NDB-003`: cross-repo context exposes required decision IDs and follow-ups for `named_decisions`
- `AT-NDB-004`: public docs list `named_decisions` as a shipped coordinator barrier and describe the contract truthfully

## Open Questions

- None for v1. `interface_alignment` remains as a narrower semantic alias for contract-alignment flows; future cleanup can decide whether to deprecate it publicly.
