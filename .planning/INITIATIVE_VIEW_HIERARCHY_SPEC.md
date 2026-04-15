## Initiative View Hierarchy Spec

### Purpose

Freeze the coordinator dashboard `Initiative` view as a first-glance overview surface, not a duplicate of the `Blockers` diagnostics surface.

### Interface

- Renderer: `cli/dashboard/components/initiative.js`
- Inputs:
  - `coordinatorState`
  - `coordinatorBarriers`
  - `barrierLedger`
  - `coordinatorBlockers`
- Related diagnostics surface:
  - `cli/dashboard/components/blockers.js`
  - `GET /api/coordinator/blockers`

### Behavior

1. `Initiative` must prioritize first-glance coordinator state:
   - super-run identity
   - overall status and phase
   - pending gate state when present
   - repo run table
   - barrier summary
2. When coordinator attention is required, the view must stay summary-level:
   - show a compact pending-gate or blocked snapshot
   - show one primary blocker summary when blockers exist
   - show one primary next action when ordered next actions exist
3. Full blocker diagnostics must remain owned by `Blockers`:
   - do not inline the full blocker list in `Initiative`
   - do not inline the full ordered next-action list in `Initiative`
   - always point operators to the `Blockers` view for complete blocker/action detail
4. The view may mention that more blockers or actions exist, but must not restate their full content inline.

### Error Cases

- If `coordinatorState` is missing, render the existing `No Initiative` placeholder.
- If `coordinatorBlockers.ok === false`, ignore blocker diagnostics and fall back to the minimal blocked-state copy from coordinator state.
- If blocker or action arrays are empty or malformed, render only the summary fields that can be derived truthfully.

### Acceptance Tests

- `AT-IVH-001`: no coordinator state renders the existing placeholder.
- `AT-IVH-002`: blocked coordinator attention renders a primary blocker summary plus one primary action, with a link to `#blockers`.
- `AT-IVH-003`: `Initiative` does not inline a full `Next Actions` section copied from the `Blockers` view.
- `AT-IVH-004`: when additional blockers or actions exist, the view states that more detail exists in `Blockers` instead of rendering every item inline.

### Open Questions

- None for this slice. If the overview needs richer drill-down later, that belongs in a deliberate expansion pattern instead of silently growing the summary surface.
