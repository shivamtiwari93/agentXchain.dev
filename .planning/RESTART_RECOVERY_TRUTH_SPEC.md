# Restart Recovery Truth Spec

## Purpose

Freeze the operator-facing recovery contract for `agentxchain restart` so it does not invent stale or generic recovery commands when a governed run is blocked or awaiting approval.

## Interface

- CLI command: `agentxchain restart`
- Shared helpers:
  - `deriveRecoveryDescriptor(state, config)`
  - `deriveRecommendedContinuityAction(state)`
- Artifact:
  - `.agentxchain/SESSION_RECOVERY.md`

## Behavior

- `restart` must derive blocked-run recovery guidance from `deriveRecoveryDescriptor(state, config)` instead of hardcoding `agentxchain step --resume`.
- If a blocked run still carries `pending_phase_transition` or `pending_run_completion`, `restart` must surface the same exact operator command that the shared recovery/continuity helpers derive.
- Pending approval messaging in `restart` console output and `SESSION_RECOVERY.md` must source the recommended command from `deriveRecommendedContinuityAction(state)` instead of embedding `approve-transition` / `approve-completion` strings in multiple places.
- `restart` may still exit non-zero for blocked runs, but the surfaced recovery action must remain truthful.

## Error Cases

- No governed project context: fail with init guidance.
- Missing `state.json`: fail with `agentxchain run` guidance.
- Completed or reserved terminal `failed` state: fail without suggesting restart.
- Blocked run with no derived recovery descriptor: fall back to the existing blocked-reason dump instead of inventing a command.

## Acceptance Tests

- `AT-RESTART-RECOVERY-001`: blocked `needs_human` restart output shows `Resolve the stated issue, then run agentxchain resume`, not `agentxchain step --resume`.
- `AT-RESTART-RECOVERY-002`: blocked run with preserved `pending_phase_transition` shows `agentxchain approve-transition`, not generic blocked guidance.
- `AT-SCR-008`: pending approval restart output and `SESSION_RECOVERY.md` continue surfacing the exact approval command after the refactor.

## Open Questions

- Should `restart` eventually write `SESSION_RECOVERY.md` even on blocked exits, or is stdout-only enough for blocked recovery in v1?
