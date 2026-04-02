# Parallel Conflict Recovery — Spec

> Defines the operator/orchestrator workflow after acceptance-time file conflict is detected between parallel governed turns.

---

## Purpose

When two parallel turns modify overlapping files, the orchestrator detects the conflict at acceptance time (DEC-PARALLEL-003). The `ConflictError` is returned, and the conflicting turn remains in `active_turns` under persisted substatus `conflicted` — it is neither accepted nor rejected at that point.

This spec defines what happens next: operator choices, orchestrator behavior for each path, prompt injection for redispatch, history/ledger recording, and the CLI surface. Without this spec, a detected conflict is a dead end — the operator sees the error but has no governed path forward.

---

## Decisions

**DEC-CONFLICT-001** — Two recovery paths exist: `reject_and_reassign` and `human_merge`. The orchestrator suggests one based on heuristics, but the operator always decides.

**DEC-CONFLICT-002** — `reject_and_reassign` uses the existing reject/retry machinery. The conflicting turn is rejected with `rejection_reason: "file_conflict"`, attempt is incremented, and redispatch includes structured conflict context. No new turn_id is created.

**DEC-CONFLICT-003** — `human_merge` preserves the original turn_id. The operator manually resolves the conflict in the working tree, re-stages `turn-result.json` with updated `files_changed`, and re-runs `accept-turn`. The turn stays in `active_turns` throughout.

**DEC-CONFLICT-004** — Conflict detection is recorded separately from rejection. Detection appends `decision: "conflict_detected"` with the conflict descriptor. Path A appends an additional `decision: "conflict_rejected"`. Path B appends `decision: "conflict_resolution_selected"` with `resolution_chosen: "human_merge"`. Only acceptances enter `history.jsonl`.

**DEC-CONFLICT-005** — The orchestrator's heuristic suggestion is: `reject_and_reassign` when the overlap is partial (< 50% of the conflicting turn's files), `human_merge` when the overlap is majority or total. The heuristic is advisory; the operator may override.

**DEC-CONFLICT-006** — After `human_merge`, the re-staged turn result must pass the full 5-stage validation pipeline including a fresh conflict check. If new acceptances occurred while the operator was merging, the conflict window has shifted and the check must account for the updated history.

**DEC-CONFLICT-007** — Conflict state is durable. The affected turn persists `status: "conflicted"` plus `conflict_state` until the operator chooses Path A or Path B and the turn either redispatches or is accepted.

**DEC-CONFLICT-008** — Human-merge re-conflict loops are explicitly bounded. If the same turn hits conflict detection three times without acceptance, the run transitions to `blocked` with `typed_reason: "conflict_loop"` and requires explicit human serialization/recovery.

**DEC-CONFLICT-009** — `reject-turn --reassign` is kept, but only as a shorthand for turns that currently persist `conflict_state`. It is not a generic reject shortcut.

**DEC-CONFLICT-010** — Conflict-caused rejections consume the same `max_turn_retries` budget as any other rejection. Conflict recovery does not get a separate retry counter; the operator escape hatch is `human_merge`.

**DEC-CONFLICT-011** — Future three-way merge support, if added, may only produce a reviewable proposal artifact. Silent auto-merge and auto-accept remain out of scope.

**DEC-CONFLICT-012** — Path A redispatch preserves non-conflicting intent as context, not as a byte-for-byte governance requirement. The orchestrator supplies `non_conflicting_files_preserved`; the retried result is judged by normal acceptance rules against the current workspace.

**DEC-CONFLICT-013** — Conflict notification remains pull-based in v1.1. CLI/status/watcher surfaces are sufficient; external webhook/chat notification is deferred.

**DEC-CONFLICT-014** — `reject_and_reassign` re-baselines the retained turn before redispatch. The turn keeps the same `turn_id`, but its `baseline`, `assigned_sequence`, `started_at`, `deadline_at`, and `concurrent_with` snapshot are refreshed to the post-conflict workspace so the retry is judged against the rebased state, not the stale pre-conflict baseline.

---

## Interface/Schema

### `ConflictError` (extended from state model spec)

```ts
interface ConflictError {
  type: "file_conflict";
  conflicting_turn: {
    turn_id: string;                              // the turn being accepted that has the conflict
    role: string;
    attempt: number;
    files_changed: string[];                      // all files this turn changed
  };
  accepted_since: AcceptedConflictEntry[];        // turns accepted after the conflicting turn was assigned
  conflicting_files: string[];                    // intersection: files touched by both sides
  non_conflicting_files: string[];                // files in the conflicting turn NOT in the intersection
  overlap_ratio: number;                          // |conflicting_files| / |conflicting_turn.files_changed|
  suggested_resolution: "reject_and_reassign" | "human_merge";
}

interface AcceptedConflictEntry {
  turn_id: string;
  role: string;
  accepted_sequence: number;
  files_changed: string[];                        // only files relevant to the conflict
}
```

### `ConflictContext` (injected into redispatch prompt)

```ts
interface ConflictContext {
  prior_attempt_turn_id: string;
  prior_attempt_number: number;
  conflict_type: "file_conflict";
  conflicting_files: string[];
  accepted_turns_since: Array<{
    turn_id: string;
    role: string;
    files_changed: string[];                      // only the conflicting files
  }>;
  non_conflicting_files_preserved: string[];      // files from the prior attempt NOT in conflict
  guidance: string;                               // human-readable merge guidance
}
```

### `ConflictLedgerEntry`

```ts
interface ConflictLedgerEntry {
  timestamp: string;                              // ISO 8601
  decision: "conflict_detected" | "conflict_rejected" | "conflict_resolution_selected";
  turn_id: string;
  attempt: number;
  role: string;
  phase: string;
  conflict: {
    conflicting_files: string[];
    accepted_since_turn_ids: string[];
    overlap_ratio: number;
  };
  resolution_chosen?: "reject_and_reassign" | "human_merge";
  operator_reason?: string;
}
```

### Recovery Descriptor Extension

```ts
// Added to the existing RecoveryDescriptor typed_reason enum:
type ConflictRecoveryDescriptor = RecoveryDescriptor & {
  typed_reason: "file_conflict";
  owner: "human";
  recovery_action: string;                        // one of the two paths
  turn_retained: true;                            // always: the turn stays in active_turns
  detail: string;                                 // lists conflicting files
};
```

### Persisted Conflict State

```ts
interface PersistedConflictState {
  detected_at: string;                            // ISO 8601
  detection_count: number;                        // increments on each new conflict for the same turn
  status: "pending_operator" | "reassigning" | "human_merging";
  conflict_error: ConflictError;
}
```

### Rebased Retained Turn Surface

`reject_and_reassign` does not introduce a new schema type, but it mutates the retained `ActiveTurn` before redispatch:

```ts
interface ActiveTurn {
  // ... existing fields ...
  baseline: Baseline;                            // recaptured after conflict rejection
  assigned_sequence: number;                     // refreshed to the latest governed sequence at redispatch
  started_at: string;                            // reset for the new attempt dispatch
  deadline_at: string;                           // reset for the new attempt dispatch window
  concurrent_with: string[];                     // refreshed to currently active sibling turn_ids
}
```

### CLI Commands

```
agentxchain reject-turn --turn <turn_id> --reason "file_conflict" [--reassign]
agentxchain accept-turn --turn <turn_id>   # after human_merge and re-staging
```

The `--reassign` flag on `reject-turn` is shorthand for: reject the conflicting turn and immediately redispatch it with conflict context. Without `--reassign`, the turn is rejected and the operator must manually run `step --resume --turn <turn_id>` to redispatch.

---

## Behavior

### 1. Conflict Detection (recap — defined in PARALLEL_TURN_STATE_MODEL_SPEC)

When `acceptGovernedTurn(turn_id)` detects file overlap:
1. The acceptance is refused.
2. A `ConflictError` is returned with the full conflict descriptor.
3. The turn remains in `active_turns` with `status: "conflicted"`.
4. `active_turns[turn_id].conflict_state` is persisted with the conflict descriptor and incremented `detection_count`.
5. The run status is NOT changed to `blocked` unless the conflict-loop guard has already been exceeded (the turn is not failed — it is in a resolvable conflict state).

### 2. Operator Decision Point

The CLI renders the conflict:

```text
┌─────────────────────────────────────────────────────────────────┐
│  CONFLICT: file_conflict                                        │
│  Turn:     turn_abc123 (dev, attempt 1)                         │
│  Files:    src/core/handler.ts, src/core/types.ts               │
│  Overlap:  2/5 files (40%) — partial overlap                    │
│  Accepted: turn_xyz789 (reviewer) modified same files           │
│                                                                 │
│  Suggested: reject_and_reassign                                 │
│                                                                 │
│  Options:                                                       │
│    agentxchain reject-turn --turn turn_abc123 --reassign        │
│    agentxchain reject-turn --turn turn_abc123 --reason "..."    │
│    (manual merge: resolve files, re-stage, accept-turn)         │
└─────────────────────────────────────────────────────────────────┘
```

The operator chooses one path. The orchestrator does not auto-resolve.

### 3. Path A: `reject_and_reassign`

This reuses the existing reject/retry machinery (DEC-CONFLICT-002):

1. **Reject the turn** — `rejectGovernedTurn(turn_id, { reason: "file_conflict", conflict_context })`:
   - Same turn_id is preserved.
   - `attempt` is incremented.
   - `active_turns[turn_id].status` → `"retrying"`.
   - `active_turns[turn_id].conflict_state.status` → `"reassigning"` before redispatch, then `null` once the new bundle is written.
   - The retained turn is re-baselined against the current workspace after the stale staged result is cleared:
     - `baseline = captureBaseline(current_workspace_state)`
     - `assigned_sequence = state.turn_sequence` at redispatch time
     - `started_at` / `deadline_at` are refreshed for the new attempt window
     - `concurrent_with` is recomputed from currently active sibling turns
   - Invalid staged result is cleared from `.agentxchain/staging/<turn_id>/`.
   - Rejected artifact snapshot is preserved under `.agentxchain/dispatch/rejected/`.
   - `ConflictLedgerEntry` with `decision: "conflict_rejected"` is appended to `decision-ledger.jsonl`.

2. **Redispatch with conflict context** — `writeDispatchBundle(turn_id)`:
   - `ASSIGNMENT.json` includes incremented `attempt` and the `conflict_context` field.
   - `PROMPT.md` includes a new `## File Conflict — Retry Required` section containing:
     - The list of conflicting files and which accepted turn modified them.
     - The list of non-conflicting files from the prior attempt whose intent should be preserved where still valid.
     - Explicit guidance: "You MUST rebase your changes on top of the current working tree state. The following files were modified by another turn since your assignment and your changes to those files were rejected."
   - `CONTEXT.md` includes the updated working tree state post-conflict (reflecting the accepted turn's changes).

3. **Agent redispatches** — The agent sees the conflict context and produces a new result that accounts for the intervening changes.

4. **Re-acceptance** — Normal acceptance flow. The conflict check runs again with the current history window, but against the refreshed `assigned_sequence` and rebased `baseline`. If the retry only introduces new non-conflicting changes on top of the accepted sibling state, the turn is accepted normally.

**Retry budget:** Conflict-caused rejections count toward `max_turn_retries` (DEC-CONFLICT-010). If the turn has already been retried for other reasons and is now at its retry limit, the conflict rejection exhausts retries and the turn escalates to `blocked` per the existing retry exhaustion contract. The intended operator escape hatch at that point is `human_merge`, not an unbounded conflict-specific retry budget.

### 4. Path B: `human_merge`

The operator resolves the conflict manually:

1. **The turn stays in `active_turns`** — No rejection, no attempt increment. The turn_id is preserved with the same attempt number (DEC-CONFLICT-003).
   - `active_turns[turn_id].status` remains `"conflicted"` until re-acceptance succeeds.
   - `active_turns[turn_id].conflict_state.status` becomes `"human_merging"`.

2. **Operator resolves in working tree:**
   - Examines the conflicting files.
   - Manually merges the conflicting turn's intended changes with the accepted turn's changes.
   - Updates the working tree to reflect the merged state.

3. **Operator re-stages** — Writes an updated `turn-result.json` to `.agentxchain/staging/<turn_id>/turn-result.json` with:
   - Updated `observed_artifact.files_changed` reflecting the post-merge file set.
   - Same `turn_id` and `attempt` as before.
   - Optional `merge_note` in the turn result describing what was manually resolved.

4. **Operator re-runs `accept-turn --turn <turn_id>`:**
   - Full 5-stage validation runs again (DEC-CONFLICT-006).
   - A fresh conflict check runs against the current history window.
   - If new turns were accepted while the operator was merging, the conflict window has shifted — the check must pass against the updated state.
   - If validation passes, the turn is accepted normally.

5. **Ledger entry** — A `ConflictLedgerEntry` with `decision: "conflict_resolution_selected"` and `resolution_chosen: "human_merge"` is appended to `decision-ledger.jsonl` when the operator selects Path B (not at re-acceptance).

### 5. Heuristic for Suggested Resolution

The orchestrator computes `overlap_ratio`:

```
overlap_ratio = |conflicting_files| / |conflicting_turn.files_changed|
```

| Overlap Ratio | Suggestion | Rationale |
|---|---|---|
| < 0.5 | `reject_and_reassign` | Most of the turn's work is unaffected. An agent can rebase the conflicting portion efficiently. |
| >= 0.5 | `human_merge` | Majority of files conflict. Agent rebase is likely to produce poor results or lose context. Human judgment is more efficient. |

The threshold is a tuning parameter, not a governance invariant. It may be adjusted based on operational experience.

### 6. Conflict Window Semantics

The conflict window for turn T is: all history entries where `accepted_sequence > T.assigned_sequence`.

This window grows over time. If the operator takes a long time to resolve a conflict (either path), additional turns may be accepted in the interim, potentially creating new conflicts. The re-acceptance check always uses the current window, not the window at original conflict detection time.

This means:
- Path A (reassign): The agent's new attempt starts from the current working tree, and the orchestrator refreshes the retained turn baseline/assignment sequence at redispatch time so already-accepted sibling work becomes part of the retry baseline instead of remaining a permanent conflict source.
- Path B (human merge): The operator must account for any additional changes that landed while they were merging. If a new conflict arises at re-acceptance, the cycle repeats.

If `detection_count >= 3` for the same turn before acceptance, the cycle does NOT repeat again. The orchestrator transitions the run to `blocked` with recovery action "serialize conflicting work, then resume the retained turn."

### 7. Interaction with Blocked State

Conflict is NOT the same as blocked:
- A conflicting turn is resolvable by the operator without external intervention.
- A blocked turn requires diagnosis of an unexpected failure.
- The run status stays `active` when a conflict is detected (assuming no other turns are blocked).

However, if the operator does not resolve the conflict and the turn's deadline expires, the turn times out per normal deadline rules and the run transitions to `blocked`. The conflict is then a contributing factor to the blocked state but not the direct cause.

### 8. Interaction with Queued Phase Transitions

If a conflicting turn also requested a phase transition:
- The transition request remains queued in `queued_phase_transition`.
- If the conflict is resolved via Path A (reassign), the queued transition is discarded — the redispatched turn must re-request it.
- If the conflict is resolved via Path B (human merge), the queued transition survives and is evaluated at drain time.

---

## Error Cases

1. **Conflict detected but turn not in `active_turns`:** Protocol error. This should not happen — the turn must be in `active_turns` to be accepted. If it occurs, the orchestrator returns a protocol violation error.

2. **Operator chooses `reject_and_reassign` but retries are exhausted:** The rejection triggers retry exhaustion escalation per the existing contract. The turn becomes `blocked` with `typed_reason: "retries_exhausted"`. The conflict is preserved in the ledger for forensics.

3. **Operator re-stages after `human_merge` but the result fails non-conflict validation:** Normal validation failure handling. The turn stays in `active_turns`, the operator gets validation errors, and they can fix and re-stage.

4. **New conflict detected at re-acceptance after `human_merge`:** The operator sees a fresh `ConflictError` with the updated conflict descriptor. `detection_count` increments. On the first and second detections, they may repeat the resolution cycle. On the third detection for the same turn, the run transitions to `blocked` with `typed_reason: "conflict_loop"`.

5. **Two turns conflict with each other simultaneously (both completing at the same time):** The first to call `acceptGovernedTurn()` wins. The second sees the conflict. This is serialized by the orchestrator's state mutex (governed state writes are atomic in v1).

6. **Conflict on a `review_only` turn:** `review_only` turns do not modify files and cannot produce file conflicts. If `observed_artifact.files_changed` is non-empty for a `review_only` turn, that is a separate validation error (artifact rule violation), not a conflict.

7. **`--reassign` flag with no remaining retries:** The rejection proceeds, exhausts retries, and the immediate redispatch is skipped. The turn goes to `blocked` instead.

8. **`--reassign` used on a turn without persisted `conflict_state`:** CLI error. The shorthand is reserved for governed file-conflict recovery only.

---

## Acceptance Tests

### Conflict Detection

| # | Assertion |
|---|-----------|
| AT-CR-01 | `acceptGovernedTurn()` returns `ConflictError` when the turn's observed files overlap with a turn accepted after assignment |
| AT-CR-02 | `ConflictError` includes `conflicting_files`, `non_conflicting_files`, `overlap_ratio`, and `suggested_resolution` |
| AT-CR-03 | The conflicting turn remains in `active_turns` with `status: "conflicted"` after conflict detection |
| AT-CR-03a | Conflict detection persists `status: "conflicted"` plus `conflict_state.conflict_error` on the affected turn |
| AT-CR-04 | Run status stays `active` (not `blocked`) after conflict detection with no other failed turns |

### Path A: reject_and_reassign

| # | Assertion |
|---|-----------|
| AT-CR-05 | `rejectGovernedTurn()` with `reason: "file_conflict"` preserves `turn_id` and increments `attempt` |
| AT-CR-06 | Rejected staged result is cleared; rejected artifact snapshot is preserved under `dispatch/rejected/` |
| AT-CR-07 | `decision-ledger.jsonl` contains a `conflict_rejected` entry with full conflict descriptor |
| AT-CR-07a | Conflict detection itself appends `decision: "conflict_detected"` before the operator chooses a resolution path |
| AT-CR-08 | Redispatch `PROMPT.md` contains `## File Conflict — Retry Required` section with conflicting files and accepted turn details |
| AT-CR-09 | Redispatch `ASSIGNMENT.json` includes `conflict_context` with conflicting files and guidance |
| AT-CR-09a | Conflict reassign refreshes the retained turn baseline and `assigned_sequence` before redispatch |
| AT-CR-10 | Re-acceptance after clean rebase succeeds with no conflict (new attempt's files don't overlap with intervening acceptances) |
| AT-CR-11 | Conflict rejection counts toward `max_turn_retries`; if at limit, the turn escalates to `blocked` |

### Path B: human_merge

| # | Assertion |
|---|-----------|
| AT-CR-12 | Turn stays in `active_turns` with same `turn_id` and same `attempt` throughout manual merge |
| AT-CR-13 | Re-staged `turn-result.json` with updated `files_changed` passes conflict check if no new intervening acceptances |
| AT-CR-14 | Re-staged result undergoes full 5-stage validation, not just conflict check |
| AT-CR-15 | If new turns were accepted during manual merge, the fresh conflict check uses the updated history window |
| AT-CR-16 | Selecting `human_merge` appends `decision: "conflict_resolution_selected"` rather than `conflict_rejected` |

### Heuristic

| # | Assertion |
|---|-----------|
| AT-CR-17 | `overlap_ratio < 0.5` → `suggested_resolution === "reject_and_reassign"` |
| AT-CR-18 | `overlap_ratio >= 0.5` → `suggested_resolution === "human_merge"` |

### CLI Surface

| # | Assertion |
|---|-----------|
| AT-CR-19 | `accept-turn` conflict renders the conflict banner with files, overlap ratio, and both resolution options |
| AT-CR-20 | `reject-turn --turn <id> --reassign` rejects and immediately redispatches the turn |
| AT-CR-21 | `reject-turn --turn <id> --reassign` with no remaining retries rejects, escalates to blocked, and does NOT redispatch |
| AT-CR-21a | `reject-turn --turn <id> --reassign` fails if the targeted turn does not persist `conflict_state` |

### Edge Cases

| # | Assertion |
|---|-----------|
| AT-CR-22 | Two turns completing simultaneously: the first accepted wins, the second sees ConflictError |
| AT-CR-23 | `review_only` turn with empty `files_changed` never triggers conflict detection |
| AT-CR-24 | Conflict on a turn that also requested phase transition: transition is discarded on Path A, preserved on Path B |
| AT-CR-25 | Conflict after deadline expiry transitions to `blocked`, not indefinite conflict state |
| AT-CR-25a | Third conflict detection for the same turn transitions the run to `blocked` with `typed_reason: "conflict_loop"` |

---

## Open Questions

1. **Conflict-aware routing:** Should the routing layer learn from conflict frequency? E.g., if two roles consistently conflict, should the orchestrator automatically serialize them even when `max_concurrent_turns > 1`? This is a v2 optimization.
