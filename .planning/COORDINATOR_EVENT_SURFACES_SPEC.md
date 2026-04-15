# Coordinator Event Surfaces Spec

## Purpose

Extend the coordinator export and governance report to include a durable aggregated child-repo event timeline. Currently, the dashboard bridge-server exposes aggregated events via `/api/coordinator/events` and WebSocket push, but the export and report surfaces only include coordinator-level history (multirepo/history.jsonl), not the per-repo lifecycle events merged into a single timeline. Completed coordinator runs should preserve a durable aggregated event summary that does not require a live bridge-server.

## Interface

### Export

Add `summary.aggregated_events` to the coordinator export:

```json
{
  "summary": {
    "aggregated_events": {
      "total_events": 12,
      "repos_with_events": ["web", "api"],
      "event_type_counts": { "run_started": 2, "turn_dispatched": 4, "turn_accepted": 4, "run_completed": 2 },
      "events": [
        {
          "repo_id": "api",
          "event_id": "evt_...",
          "type": "run_started",
          "timestamp": "2026-04-15T05:00:00Z",
          "run_id": "run_...",
          "data": {}
        }
      ]
    }
  }
}
```

- `events` array is sorted by timestamp ascending, ties broken by event_id
- Each event carries its original `repo_id`
- `event_type_counts` provides a quick summary without parsing the array
- `repos_with_events` lists repos that contributed at least one event

### Report Subject

Add `aggregated_event_timeline` to the coordinator report subject:

```json
{
  "aggregated_event_timeline": [
    {
      "repo_id": "api",
      "type": "run_started",
      "timestamp": "2026-04-15T05:00:00Z",
      "summary": "[api] run_started at 2026-04-15T05:00:00Z"
    }
  ]
}
```

### Report Rendering

- **Text**: `Aggregated Child Repo Events:` section with one line per event: `  [repo_id] type @ timestamp`
- **JSON**: `aggregated_event_timeline` array in `subject`
- **Markdown**: `## Aggregated Child Repo Events` table with columns: Timestamp | Repo | Event Type | Summary
- **HTML**: Styled table with repo_id badge coloring per repo

## Behavior

1. Export reads each child repo's `.agentxchain/events.jsonl`, tags with `repo_id`, merges, sorts by timestamp
2. If a child repo has no events file, it is skipped (not an error)
3. If the coordinator config is missing or invalid, `aggregated_events` is `null`
4. Report consumes the export's `aggregated_events` — it does not re-read files
5. Report rendering sections appear after the coordinator timeline and before barrier summary

## Error Cases

- Missing child repo directory: skip, do not fail export
- Malformed event line in JSONL: skip line, continue parsing
- No events across all repos: `aggregated_events.events` is `[]`, `total_events` is `0`
- Missing coordinator config: `aggregated_events` is `null`

## Acceptance Tests

1. Coordinator export includes `summary.aggregated_events` with correct `total_events`
2. Events in export are sorted by timestamp ascending
3. Each event carries `repo_id` matching the source repo
4. `event_type_counts` matches the actual event distribution
5. `repos_with_events` lists only repos that contributed events
6. Missing child repo events file → repo skipped, no error
7. Report text format includes "Aggregated Child Repo Events:" section
8. Report markdown format includes "## Aggregated Child Repo Events" table
9. Report HTML format includes aggregated events table with repo badges
10. Report JSON subject includes `aggregated_event_timeline` array
11. Empty events (no child repo events) → section present but shows "No child repo events"
12. Proof script exercises coordinator workspace and verifies aggregated events in export and report

## Open Questions

None. The aggregation logic already exists in `coordinator-event-aggregation.js`. This spec extends it to the durable export/report surface.
