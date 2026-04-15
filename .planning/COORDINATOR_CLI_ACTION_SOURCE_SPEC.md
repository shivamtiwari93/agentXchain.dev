# Coordinator CLI Action Source Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one operator-action authority for coordinator CLI surfaces so `multi status`, blocked `multi step`, and post-recovery `multi resume` do not invent different commands than report, audit, or the dashboard.

## Interface

- Shared helper: `deriveCoordinatorNextActions(...)`
- Shared repo snapshot reader: `collectCoordinatorRepoSnapshots(config)`
- Coordinator CLI surfaces:
  - `agentxchain multi status`
  - `agentxchain multi step`
  - `agentxchain multi resume`

## Behavior

1. `multi status`
   - Human-readable output must render ordered coordinator `next_actions` when they exist.
   - `--json` output must include `next_actions`.
2. blocked `multi step`
   - When the coordinator is already blocked or paused behind a pending gate, the error path must print the same ordered `next_actions` derived from shared coordinator state.
3. post-recovery `multi resume`
   - Success output must derive the next command from `deriveCoordinatorNextActions(...)`, not local `if pending_gate then approve-gate else step` branching.
4. config degradation
   - `multi status` must still work if the coordinator config is temporarily unreadable.
   - In that degraded case it may omit live repo drift detection, but it must still derive blocked/pending-gate actions from persisted coordinator state.

## Error Cases

- CLI surfaces must not hardcode `agentxchain multi approve-gate` or `agentxchain multi step` when shared coordinator actions already exist.
- Missing coordinator config must not make `multi status` crash just to compute `next_actions`.
- Shared next-action ordering must stay stable: `multi resume` before `multi approve-gate` when both apply.

## Acceptance Tests

- `AT-CLI-MR-012`: human-readable `multi status` renders ordered `next_actions` for blocked + pending-gate coordinator state.
- `AT-CLI-MR-013`: `multi status --json` includes `next_actions`.
- `AT-CLI-MR-014`: blocked `multi step` prints shared coordinator `next_actions` instead of one-off recovery copy.
- `AT-CLI-MR-015`: coordinator CLI implementation imports the shared next-action helper instead of hardcoding local action strings.

## Open Questions

- None for this slice.
