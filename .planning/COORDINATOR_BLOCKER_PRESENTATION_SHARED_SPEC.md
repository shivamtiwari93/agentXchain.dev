## Coordinator Blocker Presentation Shared Spec

### Purpose

Freeze one shared presentation contract for coordinator blocker attention so the `Initiative` overview and `Blockers` diagnostics surfaces do not drift on typed blocker details or primary-action selection.

### Interface

- Shared helper: `cli/src/lib/coordinator-blocker-presentation.js`
- Consuming renderers:
  - `cli/dashboard/components/initiative.js`
  - `cli/dashboard/components/blockers.js`
- Upstream action authority:
  - `cli/src/lib/coordinator-next-actions.js`
  - `GET /api/coordinator/blockers`

### Behavior

1. Typed blocker detail rows are shared:
   - `repo_run_id_mismatch` exposes repo, expected run ID, and actual run ID
   - `repo_not_ready` exposes repo, current phase, and required phase
2. `Initiative` derives its compact attention snapshot from one helper-backed summary:
   - filters out `no_next_phase`
   - chooses one primary blocker and one primary next action
   - reports additional blocker/action counts without inlining the full list
3. `Blockers` remains the full diagnostics owner:
   - renders all blockers and all next actions
   - uses the shared typed-detail helper rather than a private field map
4. Shared helpers must consume the server-provided blocker/action payloads as truth. They may summarize, but they must not invent new blocker or action reasons.

### Error Cases

- Null, malformed, or non-object blocker entries return no typed detail rows.
- Non-array blocker/action lists are treated as empty.
- `no_next_phase` is ignored for overview-summary blocker counts.

### Acceptance Tests

- `AT-CBPS-001`: shared helper returns the typed detail rows for `repo_run_id_mismatch` and `repo_not_ready`.
- `AT-CBPS-002`: shared overview summary picks one primary blocker/action and tracks additional counts while filtering `no_next_phase`.
- `AT-CBPS-003`: `Initiative` and `Blockers` both import the shared helper instead of duplicating typed blocker detail selection inline.

### Open Questions

- None for this slice. If more blocker codes need custom detail rows later, add them in the shared helper first rather than patching one renderer.
