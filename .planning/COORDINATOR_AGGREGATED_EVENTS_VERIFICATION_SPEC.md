# Coordinator Aggregated Events Verification Spec

## Purpose

Close the proof gap in coordinator exports by making `agentxchain verify export` validate `summary.aggregated_events`.

Claude's aggregated-event export/report work made the timeline durable, but it is still self-reported metadata unless the verifier can reconstruct it from the artifact itself. This slice hardens the coordinator audit surface so corrupted counts, reordered timelines, or unverifiable events from failed child exports are rejected.

## Interface

No new CLI surface.

```bash
agentxchain verify export [--input <path>|-] [--format text|json]
```

This slice extends coordinator-export verification only.

## Behavior

1. For `agentxchain_coordinator_export`, the verifier reconstructs the expected aggregated child-repo event summary from the embedded child repo exports:
   - read `repos.<repo_id>.export.files[".agentxchain/events.jsonl"].data` when `repos.<repo_id>.ok === true`
   - tag every event with `repo_id`
   - sort by timestamp ascending, ties broken by `event_id`
   - derive `total_events`, `repos_with_events`, and `event_type_counts`
2. `summary.aggregated_events` must match that reconstructed summary exactly when present.
3. If `summary.aggregated_events` claims events for a repo whose child export failed (`repos.<repo_id>.ok === false`), verification fails. The artifact does not contain enough proof bytes to justify those events.
4. Missing `.agentxchain/events.jsonl` inside a successful child export is treated as zero events for that repo.
5. Older coordinator exports that do not carry `summary.aggregated_events` remain verifier-compatible.

## Error Cases

- `summary.aggregated_events` is not an object when present
- `summary.aggregated_events.total_events` does not match the reconstructed event array length
- `summary.aggregated_events.repos_with_events` does not match the sorted set of contributing repos
- `summary.aggregated_events.event_type_counts` does not match the reconstructed type distribution
- `summary.aggregated_events.events` does not match the reconstructed sorted event list
- `summary.aggregated_events` includes a repo from `repos.<repo_id>.ok === false`

## Acceptance Tests

1. `AT-VERIFY-EXPORT-008`: tampering with coordinator `summary.aggregated_events.total_events` fails verification
2. `AT-VERIFY-EXPORT-009`: tampering with coordinator `summary.aggregated_events.events` order fails verification
3. `AT-VERIFY-EXPORT-010`: coordinator export fails verification when `summary.aggregated_events` includes events from a failed child repo
4. `AT-EXPORT-REF-007`: export schema docs state that `verify export` validates coordinator `aggregated_events` consistency when the summary is present

## Open Questions

Should coordinator exports embed minimal event-file proof for `repos.<repo_id>.ok === false` in the future so those events become verifier-clean instead of fail-closed? Not needed for this slice; fail-closed is the correct boundary now.
