# Coordinator Barrier-Ledger Narrative Spec

**Status:** Active
**Author:** Claude Opus 4.6
**Date:** 2026-04-06

## Purpose

The coordinator governance report currently surfaces a **barrier snapshot** from `barriers.json` showing current barrier states. This is useful but hides the most operationally important information: **how barriers evolved over time**.

The barrier-ledger (`barrier-ledger.jsonl`) is an append-only audit trail of every barrier transition. This spec defines how to extract and render that transition history as a first-class report section so operators can see when each barrier moved, what caused the transition, and which repos triggered it.

## Data Source

File: `.agentxchain/multirepo/barrier-ledger.jsonl`

Each entry has the schema:

```json
{
  "type": "barrier_transition",
  "timestamp": "ISO-8601",
  "barrier_id": "string",
  "previous_status": "pending | partially_satisfied | satisfied | completed",
  "new_status": "pending | partially_satisfied | satisfied | completed",
  "causation": {
    "super_run_id": "string",
    "workstream_id": "string",
    "barrier_type": "all_repos_accepted | ordered_repo_sequence | interface_alignment | shared_human_gate",
    "repo_id": "string (optional)",
    "trigger": "string (optional)"
  }
}
```

## Interface

### New function: `extractBarrierLedgerTimeline(artifact)`

Returns: `Array<BarrierTransitionEntry>`

```typescript
interface BarrierTransitionEntry {
  barrier_id: string;
  timestamp: string | null;
  previous_status: string;
  new_status: string;
  summary: string;           // Human-readable one-liner
  workstream_id: string | null;
  repo_id: string | null;    // From causation.repo_id
  trigger: string | null;    // From causation.trigger
}
```

### Summary templates

| Transition | Template |
|---|---|
| `pending → partially_satisfied` | `Barrier {barrier_id}: first repo satisfied ({repo_id})` |
| `partially_satisfied → satisfied` | `Barrier {barrier_id}: all repos satisfied ({repo_id} completed the set)` |
| `pending → satisfied` | `Barrier {barrier_id}: satisfied (single-repo barrier, {repo_id})` |
| `* → completed` | `Barrier {barrier_id}: completed` |
| Any other | `Barrier {barrier_id}: {previous_status} → {new_status}` |

### Subject integration

Added to `buildCoordinatorSubject()` return value as `barrier_ledger_timeline`.

### Report rendering

**Text format:**

```
Barrier Transitions:
  1. [2026-04-06T19:10:00.000Z] Barrier core_completion: first repo satisfied (api)
  2. [2026-04-06T19:20:00.000Z] Barrier core_completion: all repos satisfied (web completed the set)
```

**Markdown format:**

```markdown
## Barrier Transitions

| # | Time | Barrier | From | To | Summary |
|---|------|---------|------|----|---------|
| 1 | `2026-04-06T19:10:00.000Z` | `core_completion` | `pending` | `partially_satisfied` | first repo satisfied (api) |
```

Sections are omitted when the ledger is empty or absent.

## Behavior

1. Read `.agentxchain/multirepo/barrier-ledger.jsonl` via `extractFileData()`
2. Filter entries to valid objects with `type === 'barrier_transition'`
3. Preserve chronological order (ledger is append-only)
4. Map each entry to `BarrierTransitionEntry` with human-readable summary
5. Wire into `buildCoordinatorSubject()` as `barrier_ledger_timeline`
6. Render in text and markdown formatters between Barrier Summary and Repo Details

## Acceptance Tests

- **AT-BARRIER-LEDGER-001**: All ledger entries extracted in chronological order with correct fields
- **AT-BARRIER-LEDGER-002**: Each entry has barrier_id, timestamp, previous_status, new_status, and non-empty summary
- **AT-BARRIER-LEDGER-003**: Text formatter includes "Barrier Transitions:" with numbered entries
- **AT-BARRIER-LEDGER-004**: Markdown formatter includes "## Barrier Transitions" with table
- **AT-BARRIER-LEDGER-005**: Empty/absent ledger omits the section
- **AT-BARRIER-LEDGER-006**: Non-transition entries in the ledger are filtered out
- **AT-BARRIER-LEDGER-007**: Spec guard verifying this spec file exists

## Open Questions

None. This is pure rendering over existing exported data.
