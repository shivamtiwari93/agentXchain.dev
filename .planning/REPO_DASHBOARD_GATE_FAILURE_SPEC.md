# Repo Dashboard Gate Failure Spec

## Purpose

Freeze one dashboard mutation failure contract for repo-local gate approval so the dashboard does not have to special-case repo and coordinator approval failures.

## Interface

- Mutation: `POST /api/actions/approve-gate`
- Scope: repo-local pending `phase_transition` and `run_completion` approvals
- Failure payload requirements:
  - `ok: false`
  - `scope: "repo"`
  - `code`
  - `error`
  - `gate`
  - `gate_type`
  - `hook_phase` when the failure came from `before_gate`
  - `hook_name` when available
  - `next_action`
  - `next_actions`
  - `recovery_summary`

## Behavior

- Repo-local approval failures must derive recovery detail from shared governed-run helpers, not ad hoc dashboard strings.
- `next_actions` must come from `deriveGovernedRunNextActions(state, config)`.
- `next_action` must remain the first item from `next_actions` for backward compatibility.
- `recovery_summary` must mirror the shared governed blocked-state contract:
  - `typed_reason`
  - `owner`
  - `recovery_action`
  - `detail`
  - `turn_retained`
  - `runtime_guidance`
- Hook-blocked repo approval failures must preserve hook context instead of collapsing to a bare error string.

## Error Cases

- If no blocked state is available, `next_actions` may be empty and `recovery_summary` may be `null`.
- If hook metadata is unavailable, `hook_name` stays `null`; the payload must still preserve `hook_phase` when the error code proves a gate-hook failure.

## Acceptance Tests

- `AT-DASH-ACT-010`: repo-local hook-blocked `POST /api/actions/approve-gate` returns `scope: "repo"`, `next_actions`, and `recovery_summary`.
- Existing dashboard failure formatting must continue accepting the normalized payload without extra renderer branching.

## Open Questions

- None.
