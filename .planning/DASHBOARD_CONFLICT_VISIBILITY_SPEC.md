# Dashboard Conflict Visibility Spec

## Purpose

Make acceptance conflicts first-glance visible in the live dashboard timeline without inventing a new top-level view.

The durable `turn_conflicted` run event now exists in `.agentxchain/events.jsonl`, but the timeline did not read or render it. Operators could see a red `conflicted` status only if they already inspected `state.json` or a retained active turn. That is not enough. The dashboard should expose conflict metadata directly where operators already watch run progress.

## Interface

- Timeline view fetches `GET /api/events?type=turn_conflicted&limit=10` alongside `state`, `history`, and continuity data.
- Timeline view renders a `Conflicts` section when recent durable `turn_conflicted` events exist or when current `state.active_turns` contain conflicted turns.
- Each rendered conflict card shows:
  - turn ID
  - role
  - detection timestamp
  - conflict scope (`active conflict`, `recent conflict`, or `conflict loop blocked run`)
  - conflicting files
  - accepted-since turn IDs
  - overlap ratio
  - detection count

## Behavior

- The timeline must prefer the durable event payload for conflict metadata when it exists.
- Conflict cards are deduplicated by `turn_id`, newest first.
- If a current conflicted active turn has no matching durable event in the fetched window, the timeline still renders it from `state.active_turns[*].conflict_state`.
- The section remains inside the existing `Timeline` view. No new nav item is added.
- The dashboard docs must describe the conflict panel as part of Timeline and point to `/api/events` as the source.

## Error Cases

- If `/api/events` is empty or missing conflict events, the timeline must not render an empty conflict section.
- If event payloads are partial, the timeline should render the available metadata and omit missing lines rather than fail the whole view.
- Older repos without durable `turn_conflicted` events must still surface current conflicted active turns from `state.active_turns`.

## Acceptance Tests

- `AT-DASH-CONFLICT-001`: Timeline renders recent conflict cards from durable `turn_conflicted` events.
- `AT-DASH-CONFLICT-002`: Timeline falls back to active-turn `conflict_state` when no durable conflict event is present.
- `AT-DASH-CONFLICT-003`: Dashboard app timeline fetch list includes the events endpoint for conflict visibility.
- `AT-DASH-CONFLICT-004`: Dashboard docs describe Timeline conflict visibility and `/api/events` sourcing truthfully.
- `AT-DASH-CONFLICT-005`: Dashboard bridge + render pipeline shows conflict details through the live API surface.

## Open Questions

- If conflict frequency grows, the timeline may need a tighter summary or a dedicated drill-down affordance. Not required for this slice.
