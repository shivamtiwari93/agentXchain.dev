# Export Diff Command Spec

**Status:** shipped
**Created:** Turn 18 — GPT 5.4

## Purpose

`agentxchain diff` already compares two repo-local run-history entries, but it cannot compare portable audit artifacts. That leaves a real operator gap: exported run/coordinator artifacts can be replayed, verified, and reported, yet they still cannot be compared directly when an operator wants to answer "what changed between these two exports?"

This slice extends `agentxchain diff` with an explicit export mode instead of overloading the existing run-history behavior.

## Interface

```bash
agentxchain diff <left_ref> <right_ref> [--json] [--dir <path>]
agentxchain diff <left_export.json> <right_export.json> --export [--json]
```

### Inputs

- `<left_ref>` / `<right_ref>`
  - default mode: full run IDs or unique prefixes resolved from `.agentxchain/run-history.jsonl`
  - export mode: file paths to two JSON export artifacts
- `--export`
  - switches the command into export-to-export comparison mode
  - bypasses governed-project lookup; the command should work anywhere if the export files exist
- `--json`
  - emit machine-readable diff payload
- `--dir <path>`
  - only applies to repo-local run-history diff mode

## Behavior

### Mode split

- Without `--export`, `agentxchain diff` preserves the shipped run-history behavior.
- With `--export`, the command:
  - reads and parses both export artifacts
  - requires both artifacts to be valid JSON objects with `export_kind`
  - requires both artifacts to have the same `export_kind`
  - compares normalized operator-facing summaries instead of raw embedded file blobs

### Run export diff

For `agentxchain_run_export`, the diff compares:

- scalar fields:
  - `run_id`
  - `status`
  - `phase`
  - `project_name`
  - `project_goal`
  - `provenance.trigger`
  - `dashboard_session.status`
- numeric fields:
  - `history_entries`
  - `decision_entries`
  - `hook_audit_entries`
  - `notification_audit_entries`
  - `dispatch_artifact_files`
  - `staging_artifact_files`
  - `delegation_summary.total_delegations_issued`
  - `repo_decisions.active_count`
  - `repo_decisions.overridden_count`
- list deltas:
  - `active_turn_ids`
  - `retained_turn_ids`
  - active repo decision IDs
  - overridden repo decision IDs

### Coordinator export diff

For `agentxchain_coordinator_export`, the diff compares:

- scalar fields:
  - `super_run_id`
  - `status`
  - `phase`
  - `project_name`
- numeric fields:
  - `barrier_count`
  - `history_entries`
  - `decision_entries`
  - `aggregated_events.total_events`
- list deltas:
  - repo IDs present in `repos`
  - `aggregated_events.repos_with_events`
- structured deltas:
  - per-repo authority-first `repo_statuses`
  - raw coordinator linkage metadata as `coordinator_repo_statuses` when present
  - per-repo nested export availability (`repos.<id>.ok`)
  - per-event-type counts from `aggregated_events.event_type_counts`

### Output shape

- Text mode remains digestible and sectioned, with the existing `Run Diff` heading preserved for run-history mode and `Export Diff` used for export mode.
- JSON mode returns:
  - `comparison_mode`
  - `subject_kind`
  - `changed`
  - normalized `left` and `right` summaries
  - structured scalar/numeric/list deltas
  - structured coordinator-only deltas when applicable

## Error Cases

- `--export` path does not exist
- export file is invalid JSON
- export file is missing `export_kind`
- left/right export kinds differ
- export kind is unsupported for diffing
- run-history mode still keeps the existing no-project / no-run-history / ambiguous-prefix failures

## Acceptance Tests

- `AT-ED-001`: text mode compares two run exports and prints changed scalar, numeric, and repo-decision list deltas
- `AT-ED-002`: `--json --export` returns structured run-export diff output
- `AT-ED-003`: export mode compares two coordinator exports and surfaces repo-status, nested-export, and aggregated-event deltas
- `AT-ED-004`: mixed export kinds fail closed instead of guessing
- `AT-ED-005`: CLI docs describe `--export` truthfully without breaking the existing run-history contract

## Open Questions

- Should a later slice compare embedded file hashes for a deeper "artifact drift" mode?
- Should a later slice add `--only-changed` filtering for very large coordinator diffs?
