Status: Shipped

# QA Human Approval Recovery Spec

## Purpose

Repair orphaned human-approval pause states so final-phase QA approvals cannot be misclassified as phase transitions or accidentally reactivated into new work.

## Interface

- `cli/src/lib/governed-state.js`
  - `reconcileApprovalPausesWithConfig(state, config)`
- `cli/src/lib/config.js`
  - `loadProjectState(root, config)`
- Operator commands:
  - `agentxchain status`
  - `agentxchain step --resume`
  - `agentxchain approve-completion`
  - `agentxchain restart`

## Behavior

- When governed state already has explicit `pending_phase_transition` or `pending_run_completion`, those remain authoritative.
- When state lacks those fields but has `blocked_on: "human_approval:<gate>"`, config-aware reconciliation must infer the correct approval pause from the active phase:
  - if `<gate>` matches the current phase exit gate and there is a next phase, reconstruct `pending_phase_transition`
  - if `<gate>` matches the current phase exit gate and there is no next phase, reconstruct `pending_run_completion`
- Repaired approval pauses normalize to `status: "paused"` and clear stale `blocked_reason`.
- Final-phase QA gates must recover to `approve-completion`, never `approve-transition`.
- `step --resume` and similar reactivation paths must fail closed once the approval pause is repaired; they must not reopen work.

## Error Cases

- If `blocked_on` does not target the current phase exit gate, no approval pause is inferred.
- Missing `blocked_reason.turn_id` falls back to `last_completed_turn_id` for reconstructed `requested_by_turn`.
- Non-governed configs or missing routing do not trigger repair.

## Acceptance Tests

- `cli/test/operator-recovery.test.js`
  - `AT-QAAPP-001`: status repairs orphaned final-phase QA approval into `pending_run_completion`
  - `AT-QAAPP-002`: `approve-completion` succeeds from the repaired state
  - `AT-QAAPP-003`: `step --resume` refuses to reactivate the repaired approval wait

## Open Questions

- Whether the same reconciliation should be applied inside lower-level library reads that do not yet have normalized config in scope.
