# Dashboard Delegation Visibility Spec

## Purpose

Make delegation chains visible in the local governance dashboard as real governed state, not an invisible protocol feature that only exists in tests and CLI proof scripts.

## Interface

- Accepted turn history entries in `.agentxchain/history.jsonl` preserve delegation metadata when present:
  - `delegations_issued`
  - `delegation_context`
  - `delegation_review`
- Dashboard adds a top-level `Delegations` view.
- Timeline view renders delegation cues for active and accepted turns when delegation metadata exists.
- CLI docs for `agentxchain dashboard` document the new dashboard view and what it shows.

## Behavior

### History retention

- When a parent turn issues delegations, the accepted history entry records the emitted `delegations_issued`.
- When a delegated child turn is accepted, the accepted history entry records its `delegation_context`.
- When a delegation review turn is accepted, the accepted history entry records its `delegation_review`.
- These fields are additive. Existing history readers must continue to work when the fields are absent.

### Dashboard view

- The `Delegations` view reads only repo-local `state` and `history`.
- It renders three categories when data exists:
  - active queue state from `state.delegation_queue`
  - pending review state from `state.pending_delegation_review`
  - completed delegation chains reconstructed from accepted history metadata
- A delegation chain card shows:
  - parent turn and role
  - delegated items with `delegation_id`, `to_role`, charter, acceptance contract, and status
  - child turn linkage when available
  - review turn linkage and mixed-result summary when available
- If no delegation metadata exists anywhere, the view shows a truthful empty placeholder instead of implying missing data is success.

### Timeline cues

- Active delegated turns show delegation origin and charter context.
- Active review turns show that the assigned turn is a delegation review and how many results are being reviewed.
- Accepted history turns show whether they:
  - issued delegations
  - executed a delegation
  - reviewed delegation results

## Error Cases

- Missing delegation metadata in older history entries must not break dashboard rendering.
- A run may have active delegation state with no completed history yet.
- A run may have completed delegation history with an empty current queue and no pending review.
- Mixed success/failure review results must render both statuses explicitly.
- Unknown statuses must render as `unknown`, not silently map to success.

## Acceptance Tests

- `AT-DASH-DEL-001`: accepted history retains `delegations_issued` for parent turns.
- `AT-DASH-DEL-002`: accepted history retains `delegation_context` for delegated child turns.
- `AT-DASH-DEL-003`: accepted history retains `delegation_review` for review turns.
- `AT-DASH-DEL-004`: dashboard `Delegations` view renders active queue state and pending review state.
- `AT-DASH-DEL-005`: dashboard `Delegations` view reconstructs a completed delegation chain from accepted history.
- `AT-DASH-DEL-006`: timeline view renders delegation-issued, delegated-turn, and delegation-review cues.
- `AT-DASH-DEL-007`: CLI dashboard docs name the `Delegations` view and describe active queue plus completed chain visibility.

## Open Questions

- Whether coordinator workspaces need an equivalent delegation surface once delegation is supported across multi-repo runs.
- Whether the export/report surface should summarize delegation chains separately from raw history entries.
