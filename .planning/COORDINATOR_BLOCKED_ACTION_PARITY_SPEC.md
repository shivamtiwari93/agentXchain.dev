# Coordinator Blocked Action Parity Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one shared operator-action contract for blocked or drifted coordinator workspaces so `agentxchain audit` and the dashboard do not invent different recovery advice.

## Interface

- Shared helper: `deriveCoordinatorNextActions(...)`
- Inputs:
  - coordinator `status`
  - normalized `blockedReason`
  - normalized `pendingGate`
  - repo snapshots
  - coordinator `repo_runs`
  - detected `run_id_mismatches`
- Outputs:
  - ordered `next_actions[]`
  - each action exposes:
    - `code`
    - `command`
    - `reason`

## Behavior

1. `pending_gate`
   - When the coordinator is coherent and only waiting on a gate, emit `agentxchain multi approve-gate`.
2. `repo_run_id_mismatch`
   - When a child repo run identity diverges from coordinator expectations, emit `agentxchain multi resume` plus repo-specific mismatch guidance.
3. `resync`
   - When child repo status drift exists without a run-id mismatch, emit `agentxchain multi resync`.
4. generic blocked coordinator
   - When blocked without a narrower mismatch/drift explanation, emit `agentxchain multi resume`.
5. healthy active/paused coordinator
   - When there is no blocker, no pending gate, and no drift, emit `agentxchain multi step`.

## Error Cases

- Missing child repo state must not crash the dashboard blocker endpoint.
- Dashboard views must not guess coordinator recovery commands from blocker codes alone.
- Audit JSON must not depend on dashboard-only rendering branches.

## Acceptance Tests

- `AT-CBAP-001`: `GET /api/coordinator/blockers` returns `next_actions` for `repo_run_id_mismatch`.
- `AT-CBAP-002`: `GET /api/coordinator/blockers` returns `next_actions` for `pending_gate`.
- `AT-CBAP-003`: coordinator dashboard views render ordered next actions from server data.
- `AT-CBAP-004`: coordinator audit JSON preserves `subject.run.next_actions` for mismatch/resync cases.

## Open Questions

- None for this slice. Coordinator runtime guidance codes can be added later if operators need more than ordered commands plus reasons.
