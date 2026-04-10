# Run History Terminal Recording Spec

> Records all terminal outcomes (completed, blocked, failed) in the cross-run history ledger.

## Purpose

The run-history ledger (`run-history.jsonl`) must record every terminal outcome, not only completions. An operator cannot analyze failure patterns, blocked-state frequency, or recovery effectiveness if the ledger silently drops non-completion outcomes.

## Current State (Defect)

- `recordRunHistory(root, state, config, 'completed')` is called only in `approveRunCompletion()`.
- `blockRunForHookIssue()` does NOT record to the history ledger.
- Other blocked-state transitions (`needs_human`, `budget:exhausted`, `escalation:retries-exhausted`, `conflict_loop`) do NOT record.
- There is no run-level `'failed'` status in the governed state machine. `'blocked'` is the terminal failure state. The `'failed'` status exists only at the turn level.

## Interface

No new functions. The existing `recordRunHistory(root, state, config, status)` already accepts `'blocked'` as a status value.

## Behavior

### Recording Points

Add `recordRunHistory(root, blockedState, config, 'blocked')` at these terminal blocked-state transitions:

1. **`blockRunForHookIssue()`** — hook tamper or hook block at any lifecycle phase (before_assignment, before_validation, after_validation, before_acceptance, after_acceptance, before_gate). Config must be passed through from the caller.

2. **`needs_human` blocked state** — set in `acceptTurn()` when `turnResult.status === 'needs_human'`. Record after state is written.

3. **`budget:exhausted` blocked state** — set in `acceptTurn()` when `remaining_usd <= 0`. Record after state is written.

4. **`escalation:retries-exhausted` blocked state** — set in the retry-exhaustion path. Record after state is written.

5. **`conflict_loop` blocked state** — set when `detectionCount >= 3`. Record after state is written.

### Recording Boundary

- Recording is **non-fatal**: failure to record must not prevent the blocked state from being persisted.
- Recording happens **after** the blocked state is written to `state.json`, ensuring the state is durable before the ledger is appended.
- Each blocked-state entry has `status: 'blocked'` and a populated `blocked_reason` field.

### Schema

No schema changes. The existing `0.1` schema already includes `blocked_reason`, `gate_results`, and all fields needed for blocked entries.

### Config Propagation

`blockRunForHookIssue()` currently does not receive the full `config` object. It must be extended to accept `config` so it can pass it to `recordRunHistory()`.

## Error Cases

- If `recordRunHistory` fails (disk full, permissions), the blocked state is still persisted. The recording failure is silently absorbed.
- If state is set to `blocked` multiple times in the same run (e.g., resume then block again), each transition appends a new entry. This is correct: the ledger is a log, not a snapshot.

## Acceptance Tests

- **AT-RHTR-001**: `blockRunForHookIssue` records a `blocked` entry in `run-history.jsonl`.
- **AT-RHTR-002**: `needs_human` blocked path records a `blocked` entry.
- **AT-RHTR-003**: `budget:exhausted` blocked path records a `blocked` entry.
- **AT-RHTR-004**: Recording failure in `blockRunForHookIssue` does not prevent blocked state persistence.
- **AT-RHTR-005**: Multiple blocked entries from the same run produce multiple ledger lines (log, not snapshot).
- **AT-RHTR-006**: `queryRunHistory` with `--status blocked` returns only blocked entries.

## Open Questions

None. The recording boundary is clear: every terminal blocked-state write appends to the ledger.
