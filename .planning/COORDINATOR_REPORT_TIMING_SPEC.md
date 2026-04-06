# Coordinator Report Timing Spec

> `DEC-COORD-REPORT-TIME-001` — coordinator governance reports must expose timing, not just status snapshots

---

## Purpose

Coordinator governance reports currently show status, phase, barriers, and repo summaries, but they omit when the coordinator run started, when it completed, and how long it ran. That makes the report weaker than the governed-run surface and forces operators back into raw export files for basic timeline questions.

This spec closes that gap by adding coordinator timing fields and human-readable rendering backed by existing export truth.

## Interface

### JSON report fields

Under `subject.run` for `subject.kind = coordinator_workspace`:

- `created_at: string | null`
- `completed_at: string | null`
- `duration_seconds: number | null`

### Human-readable rendering

Coordinator text and markdown reports render:

- `Started`
- `Completed` when available
- `Duration` when both endpoints are available and valid

### Source data

- Coordinator history: `.agentxchain/multirepo/history.jsonl`
- Coordinator state snapshot: `.agentxchain/multirepo/state.json`

## Behavior

1. `created_at` uses the earliest coordinator `run_initialized` timestamp when present.
2. If no timestamped `run_initialized` event exists, `created_at` falls back to coordinator state `created_at`.
3. `completed_at` is only populated for completed coordinator runs.
4. For completed runs, `completed_at` uses the latest `run_completed` timestamp when present.
5. If no timestamped `run_completed` event exists for a completed run, `completed_at` falls back to coordinator state `updated_at`.
6. `duration_seconds` is derived only when both timestamps parse successfully and `completed_at >= created_at`.
7. Missing or invalid timestamps fail soft to `null`; the report still renders successfully.

## Error Cases

| Condition | Behavior |
| --- | --- |
| `history.jsonl` lacks timestamped lifecycle events | Fall back to `state.json` timestamps where possible |
| Run is not completed | `completed_at = null`, `duration_seconds = null` |
| `state.json` timestamps are missing | Return `null` fields instead of inventing times |
| Lifecycle timestamps are malformed or reversed | Return `null` duration instead of negative/invalid values |

## Acceptance Tests

- `AT-COORD-TIME-001`: Completed coordinator report prefers `run_initialized` and `run_completed` history timestamps over `state.json`.
- `AT-COORD-TIME-002`: Completed coordinator report computes `duration_seconds` from those timestamps.
- `AT-COORD-TIME-003`: Active coordinator report falls back to `state.created_at` when history lacks a timestamped `run_initialized`.
- `AT-COORD-TIME-004`: Active coordinator report leaves `completed_at` and `duration_seconds` null.
- `AT-COORD-TIME-005`: Text coordinator report renders Started / Completed / Duration when available.
- `AT-COORD-TIME-006`: Governance report docs mention coordinator timing fields alongside `coordinator_timeline` and `barrier_summary`.

## Open Questions

None. Barrier-ledger transitions are a separate narrative enhancement and do not block exposing basic coordinator timing now.
