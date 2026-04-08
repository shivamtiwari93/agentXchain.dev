# Proposal-Aware Run-Completion Gates Spec

## Purpose

Prove that run-completion gates enforce workspace-only file checks, consistent with phase-exit gate behavior. Files that exist only in `.agentxchain/proposed/<turn_id>/` must NOT satisfy run-completion `requires_files` predicates.

## Interface

- `evaluateRunCompletion()` in `cli/src/lib/gate-evaluator.js`
- `agentxchain step --role <role>` with `run_completion_request: true`
- `agentxchain proposal apply <turn_id>`

## Behavior

1. When a turn with `proposed` write authority produces gate-required artifacts and requests `run_completion_request: true`, the gate evaluator checks `existsSync(join(root, filePath))` — this checks the workspace root, NOT the proposal directory.
2. Files under `.agentxchain/proposed/<turn_id>/` are NOT visible to the gate evaluator.
3. After `proposal apply` copies files to the workspace, a subsequent turn with `run_completion_request: true` will find the files and the gate will pass.
4. The audit trail (decision ledger) records the proposal-apply action before the completion decision.

## Error Cases

- Gate-required files exist only in proposal directory → `gate_failed`, run stays `active`
- Proposal not applied before second turn → same gate failure
- Turn with invalid `artifact.type` (non-`patch`) → proposal not materialized at all

## Acceptance Tests

1. **AT-PROP-COMPLETION-001**: `evaluateRunCompletion` returns `gate_failed` when required files exist only in `.agentxchain/proposed/` (unit test)
2. **AT-PROP-COMPLETION-002**: `evaluateRunCompletion` returns `awaiting_human_approval` after proposal-applied files are in workspace (unit test)
3. **AT-PROP-COMPLETION-E2E-001**: CLI step with proposed QA turn does NOT complete the run when gate files are proposal-only
4. **AT-PROP-COMPLETION-E2E-002**: Proposal is correctly materialized in `.agentxchain/proposed/<turn_id>/`
5. **AT-PROP-COMPLETION-E2E-003**: Decision ledger records proposal-apply entry
6. **AT-PROP-COMPLETION-E2E-004**: Second QA turn completes the run after proposal apply
7. **AT-PROP-COMPLETION-E2E-005**: Audit trail has proposal-apply before completion decisions

## Open Questions

None.
