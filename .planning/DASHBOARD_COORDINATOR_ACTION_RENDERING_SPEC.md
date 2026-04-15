# Dashboard Coordinator Action Rendering Spec

## Purpose

Freeze the operator-action contract for coordinator dashboard views so approval and recovery commands come from the same server-derived blocker snapshot instead of renderer-local hardcoded CLI strings.

## Interface

- Dashboard view wiring in `cli/dashboard/app.js`
  - The `blocked` view must fetch `coordinatorBlockers` in addition to coordinator state and audit data.
- Initiative view in `cli/dashboard/components/initiative.js`
  - May summarize coordinator gate state from `coordinatorState`.
  - Must render actionable coordinator commands only from `coordinatorBlockers.next_actions`.
- Blocked view in `cli/dashboard/components/blocked.js`
  - For coordinator blocked states, must source ordered next actions from `coordinatorBlockers.next_actions` when available.
  - Must not hardcode `agentxchain multi approve-gate` in the pending-gate section.

## Behavior

- The initiative dashboard is a summary surface, not an action-authority source.
- If `coordinatorBlockers.next_actions` exists, initiative and blocked views render those commands verbatim.
- If the blocker snapshot is unavailable, initiative and blocked views may still render gate or block metadata, but they must not synthesize a CLI command that bypasses the blocker contract.
- The Blockers view remains the full-fidelity action surface for ordered coordinator recovery steps.

## Error Cases

- Missing `coordinatorBlockers`
  - Views omit coordinator action commands rather than inventing fallback CLI strings.
- `coordinatorBlockers.ok === false`
  - Views treat the blocker snapshot as unavailable and keep metadata-only rendering.
- Empty `coordinatorBlockers.next_actions`
  - Views render no coordinator action card even if a pending gate exists.

## Acceptance Tests

- `cli/test/dashboard-views.test.js`
  - Initiative renders a coordinator pending-gate command from `coordinatorBlockers.next_actions`, not from an inline literal.
  - Blocked view renders coordinator next actions from `coordinatorBlockers.next_actions` and does not emit a second hardcoded pending-gate command.
- `cli/test/dashboard-app.test.js`
  - The `blocked` view fetch contract includes `coordinatorBlockers`.

## Open Questions

- Whether the dashboard gate view should also consume shared coordinator action rendering helpers is deferred. This slice only covers initiative and blocked surfaces.
