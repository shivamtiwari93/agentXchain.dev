# Parallel Merge Acceptance — Spec

> Defines the exact orchestrator acceptance path when multiple governed turns may complete concurrently.

---

## Purpose

The current governed accept path assumes one active turn and one shared staging file. Parallel turns break that assumption in three places:

1. the operator must target exactly one staged result
2. acceptance must serialize shared-state mutations across concurrent completions
3. conflict detection, history writes, budget release, and drain-time gate evaluation must happen in one deterministic order

This spec freezes the multi-turn acceptance pipeline before implementation. It does not redefine state structure or conflict-recovery policy; it defines the acceptance transaction that applies those prior specs safely.

---

## Interface/Schema

### CLI Request

```ts
interface AcceptTurnRequest {
  turn_id?: string;                              // required when more than one active/staged turn exists
  resolution_mode?: "standard" | "human_merge"; // default: "standard"
  operator_note?: string;                        // optional audit note for manual merge acceptance
}
```

### Acceptance Outcome

```ts
type AcceptanceOutcome =
  | {
      ok: true;
      outcome: "accepted";
      turn_id: string;
      accepted_sequence: number;
      history_entry_path: string;
    }
  | {
      ok: false;
      outcome: "conflict";
      turn_id: string;
      conflict: ConflictError;
      persisted_conflict_state: PersistedConflictState;
    }
  | {
      ok: false;
      outcome: "validation_failed";
      turn_id: string;
      validation: TurnValidationResult;
    }
  | {
      ok: false;
      outcome: "target_required" | "not_found" | "lock_timeout" | "protocol_error";
      error: string;
    };
```

### Acceptance Lock

```ts
interface AcceptanceLock {
  path: ".agentxchain/locks/accept-turn.lock";
  scope: "run";
  owner_pid: number;
  acquired_at: string;                           // ISO 8601
}
```

Only one acceptance transaction may mutate `state.json`, `history.jsonl`, and `decision-ledger.jsonl` for a run at a time.

### Acceptance Transaction Journal

**Path:** `.agentxchain/transactions/accept/<transaction_id>.json`

```ts
interface AcceptanceTransactionJournal {
  transaction_id: string;
  kind: "accept_turn";
  run_id: string;
  turn_id: string;
  phase: string;
  status: "prepared" | "committed";
  prepared_at: string;                           // ISO 8601
  accepted_sequence: number;
  history_entry: HistoryEntry;
  ledger_entries: object[];
  next_state: GovernedRunState;
  cleanup_paths: string[];
}
```

The journal is a crash-recovery primitive. It exists only for success-path acceptances. Conflict outcomes do not create a journal because no history commit occurs.

---

## Behavior

### 1. Target Resolution

`accept-turn` resolves the target in this order:

1. explicit `--turn <id>`
2. implicit only-turn shortcut when exactly one active turn exists and exactly one staged result exists
3. otherwise fail with `target_required`

The CLI must not guess the target when multiple active or staged turns exist.

### 2. Acquire Lock And Reload State

Before any validation or file observation:

1. acquire `.agentxchain/locks/accept-turn.lock`
2. reload `state.json`
3. re-resolve the target turn against fresh state
4. fail with `not_found` if the turn is no longer in `active_turns`

This serialization point is mandatory. Parallel acceptance is supported by multiple active turns, not by concurrent writes to shared run state.

### 3. Validate The Targeted Staged Result

Validation runs against the target turn only:

1. read `.agentxchain/staging/<turn_id>/turn-result.json`
2. run the 5-stage validator with the targeted turn projected as the current assignment
3. if validation fails:
   - leave state unchanged
   - leave staging untouched
   - release the lock
   - return `validation_failed`

`resolution_mode = "human_merge"` does not bypass any validation stage. It only changes the expected operator path leading into acceptance.

### 4. Orchestrator Observation

After structural validation passes:

1. load the target turn baseline
2. observe the current filesystem delta for that turn
3. normalize verification and derive the observed artifact
4. compare declared vs observed files

This observation step is orchestrator-authored evidence. Agent-declared file lists remain advisory until they match observed artifact rules.

### 5. Conflict Detection And Persistence

The orchestrator evaluates conflict after observation and before any history write:

1. compute the acceptance-time conflict window: all accepted turns with `accepted_sequence > target.assigned_sequence`
2. intersect `observed_artifact.files_changed` against each intervening history entry
3. if the intersection is empty, continue to success path
4. if the intersection is non-empty:
   - build `ConflictError`
   - set `active_turns[turn_id].status = "conflicted"`
   - persist `active_turns[turn_id].conflict_state`
   - append `decision: "conflict_detected"` to `decision-ledger.jsonl`
   - if `detection_count >= 3`, transition run to `blocked` with `typed_reason: "conflict_loop"`
   - keep the staged result in place
   - release the lock
   - return `outcome: "conflict"`

No history entry is appended on conflict.

### 6. Success-Path Transaction Preparation

If validation and conflict checks pass:

1. increment `turn_sequence`
2. compute `accepted_sequence`
3. construct the `history_entry`
4. construct any decision-ledger accept entries
5. derive `next_state` in memory:
   - remove `active_turns[turn_id]`
   - clear `budget_reservations[turn_id]`
   - update `last_completed_turn_id`
   - update `accepted_integration_ref`
   - clear stale `conflict_state`
   - reconcile budget spent vs reserved
   - evaluate queued completion before queued phase transition when the run drains
6. write `AcceptanceTransactionJournal` with `status: "prepared"`

The journal is written before mutating durable history/state so the orchestrator can recover from mid-commit crashes.

### 7. Commit Order

Prepared transactions commit in this order:

1. append `history_entry` to `history.jsonl`
2. append decision ledger accept entries
3. write `next_state` to `state.json`
4. remove the target turn's staging and dispatch directories
5. mark the journal `status: "committed"` and remove it
6. release the lock

`state.json` is the visible commit point for operators. The journal prevents ambiguous partial commits before that point.

### 8. Drain-Time Gate Evaluation

Drain-time evaluation happens inside the same acceptance transaction after the target turn is removed from `active_turns`:

1. if `active_turns` is non-empty, do not evaluate queued requests
2. if `active_turns` is empty and `state.status !== "blocked"`:
   - evaluate `queued_run_completion` first
   - if completion does not finalize the run, evaluate `queued_phase_transition`
3. if `state.status === "blocked"`, queued requests remain persisted and unevaluated

This preserves the rule from the state-model spec while preventing race conditions between sibling completions.

### 9. Cleanup Scope

Acceptance cleanup is turn-scoped:

- remove `.agentxchain/staging/<turn_id>/`
- remove `.agentxchain/dispatch/turns/<turn_id>/`
- rebuild `.agentxchain/dispatch/index.json`

Sibling turn bundles, staging results, and conflict metadata remain untouched.

### 10. Crash Recovery

On CLI startup or before acquiring a new acceptance lock:

1. scan `.agentxchain/transactions/accept/` for `status: "prepared"`
2. for each prepared transaction:
   - if `state.json` already reflects the committed `accepted_sequence` and the turn is absent from `active_turns`, finish missing cleanup and delete the journal
   - otherwise replay commit steps idempotently from the journal

Prepared accept journals are authoritative recovery instructions. Manual repair is not required for a normal crash in the middle of acceptance.

---

## Error Cases

1. **`accept-turn` without `--turn` when multiple targets exist:** fail with `target_required`. No lock acquisition.

2. **Target turn exists but staging result is missing:** validation failure. No state mutation.

3. **Target turn is already `conflicted` and operator reruns plain `accept-turn` without updating the staged result:** conflict detection may return the same persisted conflict again; `detection_count` increments.

4. **Lock file exists but owner process is gone:** the orchestrator may reclaim the stale lock after timeout and continue.

5. **History append succeeds but state write crashes:** prepared journal remains. Recovery replays from the journal and finishes the commit exactly once.

6. **State write succeeds but cleanup crashes:** prepared journal remains. Recovery removes the stale turn-scoped staging/dispatch paths and deletes the journal.

7. **A sibling acceptance completes first while this command waits for the lock:** fresh-state reload may turn the target acceptance into a conflict. That is valid and must be handled by the normal conflict path.

8. **Blocked run with a healthy sibling staged result:** accepting the healthy sibling is allowed; drain-time queued requests remain unevaluated while blocked.

---

## Acceptance Tests

| # | Assertion |
|---|-----------|
| AT-PMA-01 | `accept-turn` with two active turns and no `--turn` fails with `target_required` |
| AT-PMA-02 | `accept-turn --turn <id>` acquires the acceptance lock before reading the staged result |
| AT-PMA-03 | Validation failure for one turn leaves sibling state and artifacts untouched |
| AT-PMA-04 | Acceptance-time conflict persists `status: "conflicted"` and `conflict_state`, and appends `decision: "conflict_detected"` |
| AT-PMA-05 | Conflict outcome appends no `history.jsonl` entry |
| AT-PMA-06 | Third conflict detection for the same turn blocks the run with `typed_reason: "conflict_loop"` |
| AT-PMA-07 | Successful acceptance increments `turn_sequence`, writes history, writes ledger, updates state, and removes only the target turn from `active_turns` |
| AT-PMA-08 | Successful acceptance releases only `budget_reservations[turn_id]` |
| AT-PMA-09 | When sibling turns remain active, queued completion and queued phase transition are not evaluated |
| AT-PMA-10 | When the accepted turn drains the run and no blocker exists, queued completion is evaluated before queued phase transition |
| AT-PMA-11 | Acceptance cleanup removes only `.agentxchain/staging/<turn_id>/` and `.agentxchain/dispatch/turns/<turn_id>/` |
| AT-PMA-12 | Crash after journal prepare but before state write is recoverable by idempotent journal replay |
| AT-PMA-13 | Crash after state write but before cleanup is recoverable by idempotent journal replay |
| AT-PMA-14 | A stale acceptance lock can be reclaimed safely without corrupting state |
| AT-PMA-15 | A queued healthy-sibling acceptance still succeeds while the run is top-level `blocked` on another retained turn |

---

## Open Questions

1. **Execution isolation primitive:** this spec assumes the orchestrator can observe turn-scoped filesystem deltas. Whether that is implemented with worktrees, sandboxes, or other baselines should be frozen separately before code.

2. **Journal retention policy:** should committed journals be deleted immediately, or retained briefly for audit/debugging before cleanup? Current spec deletes them after successful cleanup.

3. **Lock implementation:** file lock with stale-owner reclamation is sufficient for v1.1, but a future daemonized orchestrator may want an OS-native advisory lock instead.
