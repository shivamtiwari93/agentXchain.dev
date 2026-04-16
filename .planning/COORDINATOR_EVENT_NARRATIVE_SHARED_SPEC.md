## Coordinator Event Narrative Shared Spec

## Purpose

Freeze one shared human-readable summary contract for coordinator history events so the dashboard `Cross-Repo` timeline, governance reports, and recent-event surfaces do not drift into contradictory operator copy.

## Interface

- Shared helper: `cli/src/lib/coordinator-event-narrative.js`
- Exported function: `summarizeCoordinatorEvent(entry)`
- Consumers in this slice:
  - `cli/src/lib/report.js`
  - `cli/dashboard/components/cross-repo.js`

## Behavior

1. `summarizeCoordinatorEvent(entry)` accepts one coordinator history entry object and returns a single summary string.
2. Known coordinator history types must render these durable summaries:
   - `run_initialized`: `Coordinator run initialized with {N} repo(s)`
   - `turn_dispatched`: `Dispatched turn to {repo_id} ({role}) in workstream {workstream_id}`
   - `acceptance_projection`: `Projected acceptance from {repo_id}` plus optional `(turn {repo_turn_id})` and optional ` — {summary}`
   - `context_generated`: `Generated cross-repo context for {target_repo_id} from {N} upstream repo(s)`
   - `phase_transition_requested`: `Requested phase transition: {from} → {to}`
   - `phase_transition_approved`: `Phase transition approved: {from} → {to}`
   - `run_completion_requested`: `Requested run completion (gate: {gate})`
   - `run_completed`: `Coordinator run completed`
   - `state_resynced`: `Resynced state for {N} repo(s), {N} barrier change(s)`
   - `blocked_resolved`: `Blocked state resolved: {from} → {to}`
3. Unknown event types must remain visible and return `{type} event` plus ` at {timestamp}` when a timestamp exists.
4. `Cross-Repo` may keep its own card titles, badges, and extra detail rows, but its primary event detail line must come from the shared summary helper instead of open-coded copy.
5. `report.js` must also consume the shared helper instead of keeping a second coordinator-history summary implementation.

## Error Cases

- Missing fields fall back to `unknown`, `?`, or zero-count values instead of throwing.
- Non-object or missing entries must still yield a stable fallback summary via the unknown-event path.
- Empty upstream repo arrays and empty barrier-change arrays must render truthful zero-count summaries.

## Acceptance Tests

- `AT-COORD-EVENT-NAR-001`: the shared helper renders all recognized coordinator event summaries with stable wording.
- `AT-COORD-EVENT-NAR-002`: unknown coordinator events remain visible with raw type fallback and optional timestamp.
- `AT-COORD-EVENT-NAR-003`: `Cross-Repo` renders the shared summaries for the full recognized coordinator event set and preserves barrier/context detail rows.
- `AT-COORD-EVENT-NAR-004`: `report.js` and `cross-repo.js` both import the shared helper instead of carrying local coordinator-event summary logic.

## Open Questions

- None for this slice. If a future surface needs different phrasing, it should add secondary presentation around the shared summary rather than fork the underlying narrative contract.
