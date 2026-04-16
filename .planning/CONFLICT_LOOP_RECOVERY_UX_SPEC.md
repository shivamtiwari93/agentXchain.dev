# Conflict-Loop Recovery UX Spec

## Purpose

Freeze the operator-facing contract for conflict-loop recovery so that `status`, `recovery.mdx`, and the CLI commands agree on one truthful surface.

## Context

When a turn's `files_changed` overlap with files accepted by another turn since the conflicting turn was assigned, the governed-state layer detects a conflict. After 3 consecutive detections on the same turn, the run enters `status: 'blocked'` with `blocked_on: 'human:conflict_loop:<turn_id>'`.

## Operator-Facing Contract

### Detection Threshold

- Conflict detection count `1` or `2`: turn marked `status: 'conflicted'`, run stays `status: 'active'`, conflict metadata persisted on the turn's `conflict_state`.
- Conflict detection count `>= 3`: run transitions to `status: 'blocked'` with `typed_reason: 'conflict_loop'`.

### Status Output (both single-turn and multi-turn views)

When a turn is conflicted, `agentxchain status` MUST show:

1. Number of conflicting files
2. Detection count (e.g., "detection #2")
3. Overlap percentage
4. Suggested resolution (based on `overlap_ratio < 0.5` → `reject_and_reassign`, `>= 0.5` → `human_merge`)
5. Two concrete recovery commands:
   - `agentxchain reject-turn --turn <turn_id> --reassign`
   - `agentxchain accept-turn --turn <turn_id> --resolution human_merge`

When the run is blocked by `conflict_loop`, `status` MUST additionally show:

6. `Reason: conflict_loop`
7. `Owner: human`
8. `Action: Serialize the conflicting work, then run agentxchain reject-turn --turn <turn_id> --reassign`
9. `Turn: retained`

### Resolution Paths

**Path A — Reject and Reassign** (`reject-turn --turn <id> --reassign`):
- Rejects the conflicted turn
- Re-dispatches with conflict context (non-conflicting files preserved)
- Increments attempt count
- Refreshes the turn's baseline against the latest accepted state

**Path B — Manual Merge** (`accept-turn --turn <id> --resolution human_merge`):
- Operator manually resolves overlapping files in the working tree
- Re-stages `turn-result.json` with updated `files_changed`
- Turn runs through the full 5-stage validation pipeline again

### Overlap Heuristic

- `overlap_ratio < 0.5` → suggest `reject_and_reassign` (less rework, faster automation recovery)
- `overlap_ratio >= 0.5` → suggest `human_merge` (too many overlapping files for clean re-dispatch)

This is a suggestion, not enforcement. The operator may choose either path regardless of overlap.

## Acceptance Tests

- **AT-CLR-001**: A governed project in `conflict_loop` blocked state, when `agentxchain status` is run via subprocess, MUST output `conflict_loop` as the typed reason and show the `reject-turn --reassign` recovery action.
- **AT-CLR-002**: A governed project with a single conflicted turn (detection_count < 3, run still active), when `agentxchain status` is run via subprocess, MUST output both resolution commands (reject-turn --reassign AND accept-turn --resolution human_merge).
- **AT-CLR-003**: `recovery.mdx` MUST document the 3-detection threshold for conflict-loop blocking.
- **AT-CLR-004**: `recovery.mdx` MUST document both resolution paths with the overlap heuristic.
- **AT-CLR-005**: The `reject-turn --reassign` command MUST require the turn to have `conflict_state` — calling it on a non-conflicted turn MUST fail.

## Open Questions

None. The contract is already implemented; this spec freezes the existing behavior.
