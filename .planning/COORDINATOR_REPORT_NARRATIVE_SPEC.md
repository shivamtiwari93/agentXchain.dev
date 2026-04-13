# Coordinator Report Narrative Spec

**Status:** shipped
**Author:** Claude Opus 4.6 (Turn 43)
**Decision:** `DEC-COORD-REPORT-001` through `DEC-COORD-REPORT-005`

## Purpose

The coordinator governance report currently shows per-repo drill-downs but hides the coordinator's own event sequence behind raw JSON counts. An operator reading the report cannot reconstruct:

- What the coordinator dispatched, in what order
- When acceptance projections were created and for which repos
- When barriers transitioned and why
- When gates were requested and approved
- When resyncs occurred and what changed
- When the coordinator was blocked and when it recovered

This spec adds a **coordinator-level history narrative** and **barrier summary** to the governance report, surfacing the coordinator's event timeline as a first-class report section alongside the existing per-repo details.

## Interface

### New fields in `buildCoordinatorSubject()` return value

```javascript
{
  // existing fields unchanged
  coordinator_timeline: [
    {
      type: string,           // event type from coordinator history.jsonl
      timestamp: string,      // ISO timestamp
      summary: string,        // human-readable one-line summary
      repo_id: string | null, // affected repo, if applicable
      workstream_id: string | null,
      details: object | null, // event-specific details (gate name, barrier changes, etc.)
    }
  ],
  barrier_summary: [
    {
      barrier_id: string,
      workstream_id: string,
      type: string,           // all_repos_accepted, interface_alignment, etc.
      status: string,         // pending, partially_satisfied, satisfied
      required_repos: string[],
      satisfied_repos: string[],
    }
  ],
}
```

### New sections in text/markdown formatters

- **Coordinator Timeline** section: ordered list of coordinator events with human-readable summaries
- **Barrier Summary** section: table/list of current barrier states

## Behavior

### Event type → summary mapping

| Event type | Summary template |
|---|---|
| `run_initialized` | "Coordinator run initialized with {N} repos" |
| `turn_dispatched` | "Dispatched turn to {repo_id} ({role}) in workstream {workstream_id}" |
| `acceptance_projection` | "Projected acceptance from {repo_id} (turn {repo_turn_id}) — {summary}" |
| `context_generated` | "Generated cross-repo context for {target_repo_id} from {N} upstream repos" |
| `phase_transition_requested` | "Requested phase transition: {from} → {to}" |
| `phase_transition_approved` | "Phase transition approved: {from} → {to}" |
| `run_completion_requested` | "Requested run completion (gate: {gate})" |
| `run_completed` | "Coordinator run completed" |
| `state_resynced` | "Resynced state for {N} repos, {N} barrier changes" |
| `blocked_resolved` | "Blocked state resolved: {from} → {to}" |
| unknown type | "{type} event at {timestamp}" |

### Extraction source

- Coordinator timeline: `artifact.files['.agentxchain/multirepo/history.jsonl'].data`
- Barrier summary: `artifact.files['.agentxchain/multirepo/barriers.json'].data`

### Ordering

- Timeline events are rendered in array order (append-only log, already chronological)
- Barrier summary sorted alphabetically by barrier_id

### Edge cases

- Missing or empty history.jsonl → empty timeline array, no section rendered
- Missing or empty barriers.json → empty barrier array, no section rendered
- Unknown event types → rendered with fallback summary using type + timestamp
- Events missing optional fields (repo_id, workstream_id) → rendered with "unknown" placeholders

## Error Cases

- Malformed history entries (not objects) are skipped silently
- Barrier entries missing required fields (barrier_id) are skipped

## Acceptance Tests

- `AT-COORD-REPORT-001`: Coordinator report from a fixture with 6+ event types includes all events in `coordinator_timeline` in chronological order
- `AT-COORD-REPORT-002`: Each timeline entry has `type`, `timestamp`, and non-empty `summary`
- `AT-COORD-REPORT-003`: Text formatter includes "Coordinator Timeline:" section with numbered events
- `AT-COORD-REPORT-004`: Markdown formatter includes "## Coordinator Timeline" section with a table
- `AT-COORD-REPORT-005`: Barrier summary includes barrier_id, status, and repo coverage
- `AT-COORD-REPORT-006`: Empty history → no timeline section in output
- `AT-COORD-REPORT-007`: Unknown event type renders with fallback summary

## Open Questions

None — this is a rendering improvement with no protocol changes.
