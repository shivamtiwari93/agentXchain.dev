# Recent Event Summary Spec

## Purpose

Make recent lifecycle evidence visible in terminal-first operator surfaces without duplicating the full `agentxchain events` stream.

The dashboard already exposes live freshness and last-event visibility. `status`, `audit`, and `report` still force operators to infer recency from static state or to open a second command. That is unnecessary drift. These surfaces need one shared recent-event digest that answers:

- has anything happened recently
- what was the latest event
- is the run quiet enough to investigate

## Interface

### Shared digest

Introduce a shared recent-event digest with this shape:

- `window_minutes`
- `freshness`
  - `recent`
  - `quiet`
  - `unknown`
  - `no_events`
- `recent_count`
- `latest_event`
  - `event_type`
  - `timestamp`
  - `phase`
  - `status`
  - `turn_id`
  - `role_id`
  - `repo_id`
  - `summary`

### Freshness window

- Default recentness window: 15 minutes
- `recent_count` counts events with valid timestamps inside that window
- `freshness` derives from the latest event:
  - `recent` when the latest event timestamp is within the window
  - `quiet` when the latest event timestamp is older than the window
  - `unknown` when events exist but the latest event has no usable timestamp
  - `no_events` when there are no parseable events

### Surface ownership

- `status` shows one `Recent events` summary block for governed runs
- `status --json` includes `recent_event_summary`
- governed `audit` / `report` include one run-level recent-event summary
- coordinator `audit` / `report` include two summaries:
  - `recent_coordinator_events`
  - `recent_child_repo_events`
- raw event timelines remain owned by:
  - `agentxchain events`
  - existing report event sections

## Behavior

1. The digest is computed from one shared helper, not duplicated in each surface.
2. `status` reads repo-local `.agentxchain/events.jsonl`.
3. governed `audit` / `report` derive the digest from exported `.agentxchain/events.jsonl`.
4. coordinator `audit` / `report` derive:
   - coordinator summary from coordinator timeline entries
   - child-repo summary from aggregated child repo events
5. Text/markdown/html surfaces show:
   - freshness label
   - count inside the recentness window
   - latest event summary with timestamp
6. A summary surface must not print an inline event list. If operators need the full stream, they use `events` or the existing event sections.

## Error Cases

- Missing event file: render `no_events`, not an error
- Malformed JSONL lines: ignore malformed lines; digest valid lines only
- Missing or invalid timestamps: preserve the latest event summary but mark freshness `unknown`
- Unknown event types: preserve the raw type in `latest_event.summary`

## Acceptance Tests

- `AT-RES-001`: shared digest reports `recent` with count and latest event when recent events exist
- `AT-RES-002`: shared digest reports `quiet` when the latest event is older than the window
- `AT-RES-003`: governed `status` text and `--json` expose the recent-event digest
- `AT-RES-004`: governed `audit` / `report` expose run-level recent-event digest in JSON and text
- `AT-RES-005`: coordinator `audit` / `report` expose separate coordinator and child-repo recent-event digests

## Open Questions

- Whether `status` should later include a configurable recentness window is intentionally deferred. Fixed 15-minute behavior is enough for operator truth right now.
