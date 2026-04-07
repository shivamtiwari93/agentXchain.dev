# Coordinator Decision Ledger Writes Spec

> `DEC-COORD-LEDGER-001` — coordinator exports and reports must be backed by real coordinator-written decision entries

---

## Purpose

Close the governance gap where `.agentxchain/multirepo/decision-ledger.jsonl` existed in the schema, export, and report surfaces but was not populated by normal coordinator execution.

The ledger is not optional decoration. If the coordinator report renders `subject.decision_digest`, the coordinator must emit its own decisions during real multi-repo execution.

## Interface

### File

- Coordinator ledger: `.agentxchain/multirepo/decision-ledger.jsonl`

### Writer API

- `recordCoordinatorDecision(workspacePath, state, decision)` in `cli/src/lib/coordinator-state.js`

### Entry Shape

Each appended entry must be JSONL with:

- `id`: auto-generated sequential identifier in `DEC-COORD-###` format
- `timestamp`
- `super_run_id`
- `role`: defaults to `coordinator`
- `phase`
- `category`
- `statement`

Optional fields may include:

- `repo_id`
- `repo_run_id`
- `repo_turn_id`
- `workstream_id`
- `gate`
- `from`
- `to`
- `reason`
- `context_ref`
- `projection_ref`

## Behavior

The coordinator must append decisions for coordinator-owned lifecycle choices:

1. `initializeCoordinatorRun()` appends an `initialization` decision.
2. `dispatchCoordinatorTurn()` appends a `dispatch` decision naming repo, role, and workstream.
3. `requestPhaseTransition()` appends a `phase_transition` decision.
4. `approveCoordinatorPhaseTransition()` appends a `phase_transition` decision.
5. `requestCoordinatorCompletion()` appends a `completion` decision.
6. `approveCoordinatorCompletion()` appends a `completion` decision.
7. `resumeCoordinatorFromBlockedState()` appends a `recovery` decision when resume succeeds.

The writer must:

- fail closed if `statement` is missing or empty
- preserve monotonic coordinator decision ids by scanning the existing ledger and incrementing the highest `DEC-COORD-###` suffix
- allow report/export surfaces to consume the same file without schema changes

## Error Cases

| Condition | Behavior |
| --- | --- |
| Coordinator lifecycle event succeeds but does not append a decision | Product bug; report/export truth is incomplete |
| Decision entry has empty `statement` | Throw and fail the write path |
| Existing ledger contains malformed or unrelated ids | Ignore them for sequence generation; continue from the highest valid `DEC-COORD-###` id |
| Resume attempt fails and coordinator remains blocked | Do not append a recovery decision |

## Acceptance Tests

- AT-COORD-LEDGER-001: `multi init` path appends one `initialization` decision.
- AT-COORD-LEDGER-002: dispatch appends a `dispatch` decision with repo/workstream metadata.
- AT-COORD-LEDGER-003: phase-transition request and approval append ordered `phase_transition` decisions.
- AT-COORD-LEDGER-004: completion request and approval append ordered `completion` decisions.
- AT-COORD-LEDGER-005: successful blocked-state resume appends a `recovery` decision.
- AT-COORD-LEDGER-006: ids increment as `DEC-COORD-001`, `DEC-COORD-002`, ... across the same workspace.
- AT-COORD-LEDGER-007: the spec remains present and names the shared writer API plus all required write surfaces.

## Open Questions

None. The current need is truthful coordinator-owned writes, not a broader decision taxonomy redesign.
