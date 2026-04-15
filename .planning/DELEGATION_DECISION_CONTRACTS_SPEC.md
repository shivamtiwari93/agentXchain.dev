# Delegation Decision Contracts

## Purpose

Make delegation acceptance contracts machine-checkable when the delegated work must produce specific `DEC-NNN` decisions. This closes the gap between hierarchical delegation and governance: a parent role can now require named decisions from a child turn, and the protocol will prevent the parent review turn from advancing the phase or completing the run until those decision contracts are satisfied.

## Interface

### Delegation Schema Extension

Delegation objects may include optional `required_decision_ids`:

```json
{
  "id": "del-001",
  "to_role": "dev",
  "charter": "Finalize the API contract",
  "acceptance_contract": [
    "Implementation updated",
    "Tests pass"
  ],
  "required_decision_ids": ["DEC-101", "DEC-102"]
}
```

- `required_decision_ids`: optional non-empty array of unique `DEC-NNN` identifiers
- These IDs name the decisions the delegated child turn must emit in its accepted `decisions[]`

### Delegation Review Enrichment

When all child delegations finish and the parent review turn is created, each review result includes:

- `required_decision_ids`
- `satisfied_decision_ids`
- `missing_decision_ids`

### Acceptance Boundary

If the active turn is a delegation review turn and any child delegation has non-empty `missing_decision_ids`:

- `run_completion_request: true` is rejected
- `phase_transition_request` is rejected

The parent may still complete the review turn and route the run back to an implementation role for corrective work.

## Behavior

1. A parent turn emits delegations with optional `required_decision_ids`
2. The delegation queue stores those IDs and passes them into the child delegation context
3. The child accepted turn emits zero or more decisions in `turnResult.decisions`
4. When delegation review is assembled, the runtime compares the child decision IDs against each delegation's `required_decision_ids`
5. The review context shows which named decisions were satisfied and which are still missing
6. If any required decision IDs are still missing, the parent review turn cannot advance the phase or complete the run

## Error Cases

- `required_decision_ids` is not an array → schema validation error
- `required_decision_ids` is empty → schema validation error
- A `required_decision_ids` entry does not match `DEC-NNN` → schema validation error
- Duplicate `required_decision_ids` inside one delegation → schema validation error
- Parent review turn requests phase transition while any child delegation has missing required decisions → protocol validation error
- Parent review turn requests run completion while any child delegation has missing required decisions → protocol validation error

## Acceptance Tests

1. Delegation queue entries preserve `required_decision_ids`
2. Child `ASSIGNMENT.json` and `CONTEXT.md` include required decision IDs
3. Delegation review results include required, satisfied, and missing decision IDs
4. Parent review turn cannot request phase transition while any required decision IDs are missing
5. Parent review turn cannot request run completion while any required decision IDs are missing
6. Parent review turn can request phase transition once all required decision IDs are satisfied
7. Export/report delegation summaries preserve required/satisfied/missing decision IDs

## Open Questions

None. This extends the existing delegation lifecycle without introducing a new governance primitive.
