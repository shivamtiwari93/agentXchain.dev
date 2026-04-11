# Parallel Turn State Model — Spec

> Replaces the single-`current_turn` governed state model with a concurrent-safe multi-turn model for Tier 2.1.

---

## Purpose

v1 enforces sequential turns: `state.current_turn` is a single slot. Only one agent works at a time. This is correct for v1 but blocks real multi-agent workflows where, e.g., two developers implement independent modules in parallel within the same phase, or a reviewer works concurrently with a developer on separate files.

This spec defines the minimal state/history contract changes needed to support parallel governed turns. It does NOT cover dispatch mechanics, merge strategies, or adapter changes — those are separate specs that build on top of this state model.

---

## Decisions

**DEC-PARALLEL-001** — `current_turn` (singular) is replaced by `active_turns` (a map keyed by turn_id). The singular field is removed from the schema; backward compatibility is handled by migration.

**DEC-PARALLEL-002** — A monotonic logical clock (`turn_sequence`) replaces wall-clock ordering as the canonical history order. Each turn assignment increments the clock. Each turn acceptance records the sequence number it was assigned at AND the sequence number at acceptance time.

**DEC-PARALLEL-003** — Conflict detection is file-level and orchestrator-enforced at acceptance time, not at assignment time. Two concurrently active turns MAY be assigned overlapping file scopes, but the second to be accepted is rejected if its observed files overlap with any turn accepted after the conflicting turn was assigned.

**DEC-PARALLEL-004** — Phase transitions require all active turns in the current phase to be resolved (accepted, rejected-and-cleared, or blocked) before the gate is evaluated. A single turn cannot unilaterally advance the phase while siblings are still running.

**DEC-PARALLEL-005** — Maximum concurrency is configurable per phase via `max_concurrent_turns` (default: 1). Setting it to 1 preserves v1 sequential behavior with zero config changes.

**DEC-PARALLEL-006** — A role may have at most one active turn at a time. Two different roles may run concurrently if `max_concurrent_turns > 1`.

**DEC-PARALLEL-007** — `status = "blocked"` means operator intervention is required for at least one retained turn; it does NOT imply all sibling turns are cancelled. Already-running non-blocked turns MAY still be accepted, but no new turns may be assigned while blocked.

**DEC-PARALLEL-008** — `declared_file_scope` overlap is advisory only. It MUST produce a non-fatal warning in operator/dispatch surfaces when overlap is detected, but it MUST NOT block assignment or replace acceptance-time conflict checks.

**DEC-PARALLEL-009** — Transition/completion requests raised while sibling turns are still active are queued in dedicated drain-only fields (`queued_phase_transition`, `queued_run_completion`). Existing `pending_phase_transition` and `pending_run_completion` remain approval-only surfaces after drain-time gate evaluation.

**DEC-PARALLEL-010** — `max_concurrent_turns` is capped at `4` in v1.1. Higher fan-out is deferred until conflict resolution, merge UX, and budget controls are proven.

**DEC-PARALLEL-011** — Parallel assignment uses budget reservation, not post-hoc budget observation alone. Each active turn reserves an estimated USD amount at assignment time; new assignment fails when unreserved budget is insufficient.

**DEC-PARALLEL-012** — Acceptance-time conflicts are persisted in governed state. The affected turn stays in `active_turns`, moves to substatus `conflicted`, and carries a durable `conflict_state` descriptor until the operator resolves it.

---

## Interface/Schema

### Updated `GovernedRunState`

```ts
interface GovernedRunState {
  schema_version: "1.1";                          // bumped from "1.0"
  project_id: string;
  run_id: string | null;

  status: "idle" | "active" | "paused" | "blocked" | "completed" | "failed";
  phase: string;
  completed_at?: string;

  // ── Parallel Turn Model (replaces current_turn) ────────────
  active_turns: Record<string, ActiveTurn>;       // keyed by turn_id. Empty object = no turns.
  turn_sequence: number;                          // monotonic counter. Starts at 0, incremented on each assignment and acceptance.

  last_completed_turn_id?: string | null;         // most recently accepted turn_id (by sequence)

  // ── Blocking (unchanged) ────────────────────────────────────
  blocked_on?: string | null;
  blocked_reason?: BlockedReason;
  escalation?: Escalation | null;

  // ── Queued Requests (new drain-only surfaces) ───────────────
  queued_phase_transition?: QueuedPhaseTransition | null;
  queued_run_completion?: QueuedRunCompletion | null;

  // ── Pending Approvals (approval-only, unchanged semantics) ─
  pending_phase_transition?: PendingPhaseTransition | null;
  pending_run_completion?: PendingRunCompletion | null;

  // ── Tracking (unchanged) ────────────────────────────────────
  accepted_integration_ref?: string | null;
  next_recommended_role?: string | null;
  phase_gate_status?: Record<string, "pending" | "passed" | "failed">;
  budget_status?: BudgetStatus;
  budget_reservations?: Record<string, BudgetReservation>;
}
```

### `ActiveTurn` (replaces `CurrentTurn`)

```ts
interface ActiveTurn {
  turn_id: string;                                // Format: "turn_XXXXXXXX".
  assigned_role: string;
  status: "running" | "retrying" | "conflicted" | "failed";
  attempt: number;
  started_at: string;                             // ISO 8601.
  deadline_at: string;                            // ISO 8601.
  runtime_id: string;
  assigned_sequence: number;                      // turn_sequence value at assignment time.
  baseline?: Baseline;
  last_rejection?: LastRejection;
  declared_file_scope?: string[];                 // optional: files the agent intends to touch (advisory).
  conflict_state?: PersistedConflictState | null;
}
```

### `QueuedPhaseTransition` / `QueuedRunCompletion`

```ts
interface QueuedPhaseTransition {
  from: string;
  to: string;
  requested_by_turn: string;
  requested_at: string;                           // ISO 8601.
}

interface QueuedRunCompletion {
  requested_by_turn: string;
  requested_at: string;                           // ISO 8601.
}
```

### `BudgetReservation`

```ts
interface BudgetReservation {
  turn_id: string;
  reserved_usd: number;                           // non-negative decimal
  reserved_at: string;                            // ISO 8601.
  basis: "phase_default" | "runtime_default" | "explicit";
}

interface PersistedConflictState {
  detected_at: string;                            // ISO 8601.
  detection_count: number;                        // starts at 1, increments on each new conflict for the same turn.
  status: "pending_operator" | "reassigning" | "human_merging";
  conflict_error: ConflictError;
}
```

### `HistoryEntry` additions

```ts
interface HistoryEntry {
  // ... all existing fields unchanged ...

  // ── Parallel ordering ───────────────────────────────────────
  assigned_sequence: number;                      // sequence at assignment time
  accepted_sequence: number;                      // sequence at acceptance time
  concurrent_with: string[];                      // turn_ids that were active when this turn was assigned
}
```

### Config addition: `routing[phase].max_concurrent_turns`

```ts
interface PhaseRouting {
  // ... existing fields ...
  max_concurrent_turns?: number;                  // default: 1. Minimum: 1. Maximum: 4.
}
```

---

## Behavior

### 1. Assignment (`assignGovernedTurn()`)

**Pre-conditions (all must pass):**
- `state.status === "active"`
- `Object.keys(state.active_turns).length < max_concurrent_turns` for current phase
- No active turn already assigned to the same role (DEC-PARALLEL-006)
- Clean baseline check passes (unchanged)
- Budget reservation check passes (DEC-PARALLEL-011)

**Effect:**
1. Increment `state.turn_sequence`.
2. Create a new `ActiveTurn` with `assigned_sequence = state.turn_sequence`.
3. Set `active_turns[turn_id] = newTurn`.
4. Snapshot `concurrent_with` = all other turn_ids currently in `active_turns`.
5. Create `budget_reservations[turn_id]` with the estimated assignment reservation.
6. If `declared_file_scope` overlaps any sibling turn's declared scope, emit a non-fatal advisory warning for operator/dispatch surfaces (DEC-PARALLEL-008).

### 2. Acceptance (`acceptGovernedTurn()`)

**Pre-conditions:**
- The turn_id exists in `state.active_turns`
- Staged turn result passes the 5-stage validation pipeline (unchanged)
- **Conflict check passes** (new — see §3)

**Effect:**
1. Increment `state.turn_sequence` (acceptance is a sequenced event).
2. Record `accepted_sequence = state.turn_sequence` in the history entry.
3. Record `concurrent_with` from the turn's assignment snapshot.
4. Remove the turn from `active_turns`.
5. Update `last_completed_turn_id`.
6. Release the turn's budget reservation and reconcile reserved vs actual cost.
7. If `state.active_turns` is now empty, evaluate any queued completion request first, then any queued phase transition.
8. Append to `history.jsonl` and `decision-ledger.jsonl` (unchanged).

### 3. Conflict Detection at Acceptance

When accepting turn T:

1. Collect `T.observed_artifact.files_changed` (orchestrator-observed).
   For parallel turns, this is the conflict candidate set: attributed observed files plus any declared file that still appears in the raw baseline-to-now observation.
2. Collect all turns accepted AFTER T was assigned: filter `history.jsonl` where `accepted_sequence > T.assigned_sequence`.
3. Compute the intersection of T's files with each intervening accepted turn's `observed_artifact.files_changed`.
4. If intersection is non-empty → **conflict**. Acceptance fails with a structured conflict error.

The conflict error includes:
```ts
interface ConflictError {
  conflicting_turn_id: string;
  conflicting_files: string[];
  resolution: "reject_and_reassign" | "human_merge";  // orchestrator suggests, human decides
}
```

**Key design choice:** conflict is detected at acceptance, not assignment. This is intentional:
- At assignment time, we don't know what files the agent will actually touch.
- `declared_file_scope` is advisory and cannot be trusted for governance.
- Detecting at acceptance means the conflict is based on actual observed changes, not predictions.

When conflict is detected:
1. The turn remains in `active_turns`.
2. `active_turns[turn_id].status = "conflicted"`.
3. `active_turns[turn_id].conflict_state` is persisted with the full conflict descriptor and an incremented `detection_count`.
4. Top-level `state.status` remains unchanged unless another turn is already blocked.

### 4. Rejection (`rejectGovernedTurn()`)

Unchanged per-turn semantics. Rejection targets a specific turn_id in `active_turns`:
- If retries remain: increment attempt, set status to "retrying", keep in `active_turns`.
- If retries exhausted: set run to `blocked`, preserve the failed turn in `active_turns` (other active turns continue unaffected).

**Blocked coexistence rule:** When one turn is blocked/escalated, other active turns are NOT automatically cancelled. They continue running. The run status becomes `blocked`, the non-failed turns in `active_turns` may still be accepted when they complete, and `blocked` is cleared only when all failed/escalated turns are resolved. While `status === "blocked"`, new assignment is forbidden even if concurrency capacity remains.

### 5. Phase Transition Gating

Phase gate evaluation (`evaluatePhaseExit()`) is triggered only when:
- A turn requests a phase transition via `phase_transition_request`
- AND `Object.keys(state.active_turns).length === 0` after the requesting turn is accepted

If other turns are still active when a phase transition is requested:
- The requesting turn is accepted normally.
- The phase transition request is queued in `queued_phase_transition`.
- When the last active turn completes, the queued transition is evaluated.

### 6. Run Completion Under Concurrency

`run_completion_request = true` is handled the same way as phase transition requests with one stricter rule: completion is evaluated before phase advancement after drain.

If siblings are still active when a turn requests completion:
- The requesting turn is accepted normally.
- `queued_run_completion` is set.
- The run does NOT complete until:
  - `Object.keys(state.active_turns).length === 0`
  - `state.status !== "blocked"`
  - the final-phase completion gate passes

If drain later produces a blocker, the queued completion remains persisted but cannot finalize until the blocker is resolved.

### 7. History Ordering

History entries are ordered by `accepted_sequence`, not by wall-clock `accepted_at`. This guarantees a total order even when two turns are accepted in rapid succession.

For display purposes, the history can be rendered as a DAG:
- Turns with overlapping `[assigned_sequence, accepted_sequence]` ranges were concurrent.
- `concurrent_with` provides the explicit concurrency set at assignment time.

### 8. `active_turns` emptiness semantics

| `active_turns` state | Run status | Meaning |
|---|---|---|
| `{}` (empty) | `active` | Ready for next assignment |
| `{}` (empty) | `blocked` | Blocked, no turns in flight |
| `{}` (empty) | `paused` | Waiting for approval |
| 1+ entries, all `running` | `active` | Normal parallel execution |
| 1+ entries, any `conflicted` and none `failed` | `active` | Operator action required for one turn, but the run is not blocked |
| 1+ entries, any `failed` | `blocked` | At least one turn needs intervention |
| 1+ entries, mixed `running`/`retrying`/`conflicted` | `active` | Retrying or conflicted turns still count as in-flight |

---

## Error Cases

1. **Assignment beyond `max_concurrent_turns`:** Returns structured error with current count and limit. No state mutation.

2. **Duplicate role assignment:** Returns error identifying the existing active turn for that role. No state mutation.

3. **Acceptance with conflict:** Returns `ConflictError`. The turn remains in `active_turns`, moves to `status: "conflicted"`, and persists `conflict_state`. The operator must either:
   - Reject the turn (retry with conflict awareness in the prompt)
   - Resolve the conflict manually and re-stage

4. **Phase transition with active siblings:** The transition is queued, not rejected. If a sibling later fails, the queued transition remains persisted but cannot be evaluated until the blocker is resolved and the run drains.

5. **Blocked with active siblings:** Run status is `blocked`. Still-running turns can still be accepted (acceptance clears their slot). The `blocked` status is cleared only when the failed/escalated turn is resolved via `step --resume`.

6. **Multiple queued phase transitions:** Only one `queued_phase_transition` is allowed. If a second turn also requests a phase transition, it is accepted but its request is logged and discarded with a warning. First-requestor wins.

7. **`max_concurrent_turns` reduced mid-run:** Existing active turns are not cancelled. New assignments are blocked until the count drops below the new limit.

8. **Deadline expiry for one of N parallel turns:** Only that turn is affected. If the adapter reports timeout, the orchestrator blocks that turn specifically. Other turns continue.

9. **Completion request with active siblings:** `queued_run_completion` is set. If another turn also requests completion before drain, the first requestor wins and the second request is logged and discarded with a warning.

10. **Budget oversubscription under concurrency:** Assignment fails before dispatch when `budget_status.remaining_usd - reserved_usd < estimated_turn_cost_usd`. No turn is assigned and no reservation is written.

---

## Migration / Backward Compatibility

### Schema Migration (v1.0 → v1.1)

On `readGovernedState()`:

1. If `schema_version === "1.0"` and `current_turn` exists:
   - Set `active_turns = { [current_turn.turn_id]: { ...current_turn, assigned_sequence: 1 } }`
   - Set `turn_sequence = 1`
   - Delete `current_turn`
   - Set `schema_version = "1.1"`
2. If `schema_version === "1.0"` and `current_turn === null`:
   - Set `active_turns = {}`
   - Set `turn_sequence = 0`
   - Delete `current_turn`
   - Set `schema_version = "1.1"`
3. Initialize `queued_phase_transition = null`, `queued_run_completion = null`, and `budget_reservations = {}` if absent.
4. Write migrated state back (idempotent).

### Config Compatibility

- If `max_concurrent_turns` is absent from a phase's routing config, default to `1`. This means v1 configs work unchanged with sequential behavior.

### History Compatibility

- Existing `history.jsonl` entries lack `assigned_sequence`, `accepted_sequence`, and `concurrent_with`. Readers must treat missing fields as:
  - `assigned_sequence`: infer from line position (0-indexed)
  - `accepted_sequence`: same as assigned_sequence (sequential assumption)
  - `concurrent_with`: `[]`

### CLI Compatibility

- `agentxchain status` must render multiple active turns when present.
- `agentxchain step` with `max_concurrent_turns = 1` behaves identically to v1.
- `agentxchain accept-turn` and `agentxchain reject-turn` gain a required `--turn <turn_id>` argument when multiple turns are active. When exactly one turn is active, the argument is optional (defaults to that turn).

---

## Acceptance Tests

### Schema / Validation

| # | Assertion |
|---|-----------|
| AT-P-01 | `validateGovernedStateSchema()` accepts `active_turns` as a map of `ActiveTurn` objects and rejects `current_turn` when `schema_version === "1.1"` |
| AT-P-02 | `validateGovernedStateSchema()` requires `turn_sequence` as a non-negative integer |
| AT-P-03 | State round-trip: write state with 2 active turns, read back, both preserved with all fields |

### Assignment

| # | Assertion |
|---|-----------|
| AT-P-04 | `assignGovernedTurn()` with `max_concurrent_turns = 2` and 0 active turns succeeds and creates one entry in `active_turns` |
| AT-P-05 | `assignGovernedTurn()` with `max_concurrent_turns = 2` and 1 active turn to a different role succeeds and creates a second entry |
| AT-P-06 | `assignGovernedTurn()` with `max_concurrent_turns = 2` and 2 active turns fails with concurrency limit error |
| AT-P-07 | `assignGovernedTurn()` with a role that already has an active turn fails with duplicate-role error |
| AT-P-08 | Each assignment increments `turn_sequence` by exactly 1 |
| AT-P-09 | `assigned_sequence` on the new turn equals the post-increment `turn_sequence` value |

### Acceptance / Conflict

| # | Assertion |
|---|-----------|
| AT-P-10 | `acceptGovernedTurn()` for a turn with no file conflicts removes it from `active_turns` and appends to history |
| AT-P-11 | `acceptGovernedTurn()` for a turn whose observed files overlap with a turn accepted after its assignment returns `ConflictError` |
| AT-P-11a | Acceptance-time conflict persists `active_turns[turn_id].status = "conflicted"` and stores `conflict_state.conflict_error` |
| AT-P-11b | Repeated conflicts for the same retained turn increment `conflict_state.detection_count` monotonically |
| AT-P-12 | History entry includes `assigned_sequence`, `accepted_sequence`, and `concurrent_with` |
| AT-P-13 | `accepted_sequence > assigned_sequence` for any turn (acceptance always increments) |
| AT-P-14 | Two turns assigned concurrently that touch disjoint files are both accepted successfully |

### Phase Gating

| # | Assertion |
|---|-----------|
| AT-P-15 | Phase gate evaluation is NOT triggered when accepting a turn if other turns remain in `active_turns` |
| AT-P-16 | Phase gate evaluation IS triggered when the last active turn is accepted and a `queued_phase_transition` exists |
| AT-P-17 | `queued_phase_transition` is set when a turn requests phase transition but siblings are still active |
| AT-P-18 | Only one `queued_phase_transition` is stored; a second request logs a warning and is discarded |

### Rejection / Blocked

| # | Assertion |
|---|-----------|
| AT-P-19 | Rejecting one of two active turns with retries remaining keeps both in `active_turns`; the rejected turn has `status: "retrying"` |
| AT-P-20 | Rejecting one of two active turns at max retries sets `state.status = "blocked"` but does not cancel the other turn |
| AT-P-21 | Accepting the non-blocked turn while the run is `blocked` succeeds; the accepted turn is removed from `active_turns` |
| AT-P-22 | `step --resume` on a blocked run with one failed turn in `active_turns` redispatches only that turn |
| AT-P-22a | While `status = "blocked"` and a healthy sibling is still active, `assignGovernedTurn()` refuses new assignment even if below `max_concurrent_turns` |

### Migration

| # | Assertion |
|---|-----------|
| AT-P-23 | v1.0 state with `current_turn` is migrated to `active_turns` with one entry on read |
| AT-P-24 | v1.0 state with `current_turn = null` is migrated to `active_turns = {}` on read |
| AT-P-25 | Migration sets `schema_version = "1.1"` and removes `current_turn` field |
| AT-P-26 | Migration is idempotent: migrating an already-migrated state produces no change |
| AT-P-27 | History entries without `assigned_sequence` are readable with inferred sequential values |

### Completion / Budget

| # | Assertion |
|---|-----------|
| AT-P-27a | A turn accepted with `run_completion_request = true` while siblings remain active sets `queued_run_completion` instead of completing immediately |
| AT-P-27b | When the last sibling drains and no blocker exists, queued completion is evaluated before queued phase transition |
| AT-P-27c | Assignment with remaining budget below the required reservation fails before creating a new active turn |
| AT-P-27d | Accepting or rejecting a turn releases its `budget_reservations[turn_id]` entry |

### CLI

| # | Assertion |
|---|-----------|
| AT-P-28 | `agentxchain status` with 2 active turns renders both with their roles and statuses |
| AT-P-29 | `accept-turn` with 2 active turns and no `--turn` argument fails with "specify --turn" error |
| AT-P-30 | `accept-turn --turn <id>` with 2 active turns accepts only the specified turn |
| AT-P-31 | `accept-turn` with 1 active turn and no `--turn` argument succeeds (defaults to the only turn) |
| AT-P-32 | With `max_concurrent_turns = 1`, the full v1 flow (assign → dispatch → accept → assign) works unchanged |
| AT-P-33 | `status` on a blocked run with one failed turn and one running sibling renders both the blocker and the still-active sibling count |

---

## Open Questions

1. **Conflict resolution UX:** When a conflict is detected at acceptance, what is the operator's workflow? Options:
   - (a) Reject the conflicting turn, re-assign with conflict context in the prompt
   - (b) Manual merge by the operator, then re-stage
   - (c) Orchestrator-mediated three-way merge (complex, likely v2)
   Spec currently offers (a) and (b) as operator choices. Need to confirm this is sufficient for v1.1.

2. **Sequence counter persistence:** `turn_sequence` is monotonic and never resets within a run. Should it reset across runs, or should it be project-global? Current spec: per-run.

3. **Reservation estimation source:** What is the default estimated-cost source for budget reservation: runtime-level static estimate, model-family estimate, or operator-configured per-role override? This affects config surface but not the reservation requirement itself.
