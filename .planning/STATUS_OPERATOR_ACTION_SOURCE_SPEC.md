## Purpose

Freeze the operator-action source contract for human-readable governed `status` output.

## Interface

- `agentxchain status`
- `deriveRecoveryDescriptor(state, config)`
- `deriveConflictedTurnResolutionActions(turnId)`

## Behavior

- Human-readable `status` must not hardcode pending approval commands for `pending_phase_transition` or `pending_run_completion`.
- Pending approval commands shown by `status` must come from the shared recovery descriptor path, so the rendered action stays aligned with the blocked-state contract.
- Conflicted-turn recovery options must be derived from one shared helper, not duplicated separately in `status` and `step`.
- The shared conflicted-turn helper must return both supported resolution commands:
  - `agentxchain reject-turn --turn <turn_id> --reassign`
  - `agentxchain accept-turn --turn <turn_id> --resolution human_merge`

## Error Cases

- If command renderers hardcode approval or conflict commands, they can drift from the shared governance contract and mislead operators.
- If the conflicted-turn helper is called without a turn id, it must fail closed instead of emitting an unusable command.

## Acceptance Tests

- `status` pending-approval output contains only the shared recovery `Action:` line and does not add a second bespoke approval action line.
- `status` and `step` both source conflicted-turn recovery commands from the shared helper.
- The conflicted-turn helper returns the exact reassign and human-merge commands for a specific turn id.

## Open Questions

- None.
