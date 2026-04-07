# Blocked Recovery Guidance Spec

## Purpose

Close recovery-surface drift outside operator escalations so blocked-state guidance stays executable across persisted state, `status`, reports, and docs.

## Interface

- Recovery actions remain persisted under `state.blocked_reason.recovery.recovery_action`.
- `deriveRecoveryDescriptor()` in `cli/src/lib/blocked-state.js` remains the canonical read surface.
- `loadProjectState()` reconciles legacy default recovery actions to the current truthful command when the action was auto-generated, not operator-authored.

## Behavior

### Runtime-aware retained-turn recovery

- If a blocked state retains a `manual` turn, the default non-waiting recovery command is `agentxchain resume`.
- If a blocked state retains a non-manual turn, the waiting recovery command remains `agentxchain step --resume`.
- If multiple retained turns exist and one turn is the recovery target, the surfaced command includes `--turn <id>`.

### Cleared-turn recovery

- `needs_human` after an accepted turn is a cleared-turn block, not a retained-turn block.
- The default `needs_human` recovery command is therefore `agentxchain resume`, not `agentxchain step --resume`.

### Conflict loop recovery

- `conflict_loop` must never recommend `step --resume` or `resume` because conflicted turns are intentionally not resumable.
- The default surfaced action is `agentxchain reject-turn --turn <id> --reassign`.
- Docs may mention `accept-turn --resolution human_merge` as the alternate manual path, but the persisted default action must be directly executable.

### Legacy-state reconciliation

- Reconciliation refreshes only legacy default-generated actions for:
  - `operator_escalation`
  - `retries_exhausted`
  - `needs_human`
  - retained-turn `hook_tamper`
  - retained-turn `hook_block` from `after_dispatch`
  - `conflict_loop`
- Explicit operator overrides are not rewritten.

## Error Cases

- If the retained turn cannot be resolved, the helper falls back to the existing safe command contract instead of inventing a turn id.
- If a conflicted turn id is missing, the recovery action still points at `agentxchain reject-turn --reassign` rather than a resume command.

## Acceptance Tests

1. `status` on a blocked `needs_human` run with no retained turn shows `agentxchain resume`.
2. `status` on a blocked retained manual `hook_tamper` run shows `agentxchain resume`.
3. `status` on a blocked retained non-manual `hook_tamper` run shows `agentxchain step --resume`.
4. Legacy blocked states using stale default recovery actions are rewritten on load to the current truthful action.
5. Third conflict detection persists `typed_reason = "conflict_loop"` with `agentxchain reject-turn --turn <id> --reassign`.
6. Recovery docs describe `needs_human` as a cleared-turn `resume` path and `conflict_loop` as a conflict-resolution path, not a resume path.

## Open Questions

- None for this slice. Broader non-escalation recovery guidance is bounded to default-generated blocked states only.
