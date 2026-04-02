# Persistent Blocked Sub-State — Spec

> Promotes `blocked` from a derived/inferred condition to a first-class persisted `state.json.status` value.

---

## Purpose

Today, `state.json.status` can be `idle`, `active`, `paused`, `completed`, or (reserved) `failed`. When a run is stuck — waiting for human recovery after dispatch failure, retry exhaustion, or an explicit `needs_human` response — the persisted status is either `active` (dispatch failure mid-turn) or `paused` (escalation / needs_human / approval gate). External tools, dashboards, and editor integrations cannot distinguish "active and running" from "active but stuck waiting for human action" without parsing `current_turn.status`, `blocked_on`, and `escalation` fields.

This spec introduces `blocked` as a first-class `state.json.status` value that makes stuckness visible at the top level.

---

## Decisions

**DEC-BLOCKED-001** — `blocked` is a new legal run status alongside `idle`, `active`, `paused`, `completed`, `failed`.

**DEC-BLOCKED-002** — `blocked` replaces _some_ current uses of `paused`. The distinction:
- `paused` = protocol-initiated pause requiring a known human approval action (phase transition, run completion). The operator knows exactly what to do: run a specific approval command.
- `blocked` = the run cannot make forward progress due to an unresolved condition that requires human diagnosis or external action. The operator must understand the problem, resolve it, then resume.

**DEC-BLOCKED-003** — `paused` continues to exist for approval gates. It is NOT removed or merged into `blocked`.

**DEC-BLOCKED-004** — Backward compatibility: existing `state.json` files with `status: "paused"` and a `blocked_on` field starting with `human:` or `escalation:` are migrated to `blocked` on first read by the orchestrator. Migration is in-place and idempotent.

**DEC-BLOCKED-005** — The `blocked_on` field remains the authoritative detail. `status: "blocked"` is the coarse signal; `blocked_on` is the fine-grained reason.

**DEC-BLOCKED-006** — Dispatch failure writes `status: "blocked"` only when the adapter has already surfaced a final failure to the orchestrator. Transient retry attempts stay adapter-local.

**DEC-BLOCKED-007** — `blocked_reason` is required whenever `status === "blocked"` and stores the persisted recovery descriptor used by CLI surfaces.

**DEC-BLOCKED-008** — `schema_version` remains `"1.0"` for this implementation because the package has not shipped `1.0.0` yet.

---

## Interface/Schema

### Updated Run State Shape

```ts
type GovernedRunState = {
  schema_version: "1.0";  // unchanged — additive status, not a schema break
  run_id: string | null;
  project_id: string;
  status: "idle" | "active" | "paused" | "blocked" | "completed" | "failed";
  phase: string;
  accepted_integration_ref?: string | null;
  current_turn: CurrentTurn | null;
  last_completed_turn_id?: string | null;
  blocked_on?: string | null;        // required when status === "blocked"
  blocked_reason?: BlockedReason;     // new structured reason
  escalation?: Escalation | null;
  pending_phase_transition?: PendingPhaseTransition | null;
  pending_run_completion?: PendingRunCompletion | null;
  next_recommended_role?: string | null;
  phase_gate_status?: Record<string, "pending" | "passed" | "failed">;
  budget_status?: {
    spent_usd: number;
    remaining_usd: number | null;
  };
  completed_at?: string;
};
```

### New `BlockedReason` type

```ts
type BlockedReason = {
  category:
    | "needs_human"           // agent reported needs_human
    | "retries_exhausted"     // retry exhaustion escalation
    | "dispatch_error"        // adapter dispatch failed, turn preserved
    | "external_dependency"   // future: waiting on external system
    ;
  recovery: RecoveryDescriptor;  // reuses existing contract from BLOCKED_STATE_INTERFACE.md
  blocked_at: string;            // ISO 8601 timestamp
  turn_id: string | null;        // which turn caused the block, if any
};
```

### Invariants

- `status === "blocked"` implies `blocked_on !== null && blocked_on !== undefined`
- `status === "blocked"` implies `blocked_reason !== null && blocked_reason !== undefined`
- `status === "paused"` implies `pending_phase_transition || pending_run_completion` (tightened from current)
- `status === "active"` implies `blocked_on === null` (tightened from current)

---

## Behavior

### 1. Status Transition Table (replaces STATE_MACHINE_SPEC §3 for affected rows)

| From | Trigger | To | Condition |
|---|---|---|---|
| `idle` | `initializeGovernedRun()` | `active` | unchanged |
| `active` | `acceptGovernedTurn()` with `needs_human` | **`blocked`** | was: `paused` |
| `active` | `acceptGovernedTurn()` with gate requiring approval | `paused` | unchanged — approval gate |
| `active` | `acceptGovernedTurn()` with final completion requiring approval | `paused` | unchanged — approval gate |
| `active` | `acceptGovernedTurn()` with final gate passing | `completed` | unchanged |
| `active` | `rejectGovernedTurn()` with retries exhausted | **`blocked`** | was: `paused` |
| `active` | dispatch failure (adapter error, turn preserved) | **`blocked`** | new: was implicit active-but-stuck |
| `paused` | `approvePhaseTransition()` | `active` | unchanged |
| `paused` | `approveRunCompletion()` | `completed` | unchanged |
| **`blocked`** | `step --resume` or `step` (redispatch) | `active` | human resolved the issue |
| **`blocked`** | `step --resume` after `needs_human` resolved | `active` | human resolved the issue |

### 2. Which conditions become `blocked` vs stay `paused`

| Condition | Current status | New status | Rationale |
|---|---|---|---|
| `blocked_on = human:*` (needs_human) | `paused` | **`blocked`** | Requires diagnosis, not just an approval click |
| `blocked_on = escalation:retries-exhausted:*` | `paused` | **`blocked`** | Requires human investigation of the failure |
| `pending_phase_transition` | `paused` | `paused` | Known approval action, no diagnosis needed |
| `pending_run_completion` | `paused` | `paused` | Known approval action, no diagnosis needed |
| Dispatch failure mid-turn | `active` (implicit) | **`blocked`** | Currently invisible at top level |

### 3. `step --resume` from `blocked`

Today, `step` can resume from `paused` when a preserved failed/retrying turn exists. With this spec:

- `step --resume` from `blocked` clears `blocked_on`, clears `blocked_reason`, sets `status = "active"`, and redispatches the preserved turn.
- `step` (without `--resume`) from `blocked` with no `current_turn` clears blocked state and proceeds to new assignment.
- The operator is responsible for having resolved the underlying issue before resuming.

### 4. CLI `status` rendering

When `status === "blocked"`:

```text
Run:     run_abc123
Status:  BLOCKED
Phase:   implementation
Blocked: needs_human — "Clarification needed on API contract"
Owner:   human
Action:  Resolve the stated issue, then run agentxchain step --resume
Turn:    turn_xyz789 (retained)
```

### 5. Migration from existing `paused` states

On `readGovernedState()` (or equivalent state load):

1. If `status === "paused"` AND `blocked_on` starts with `"human:"` → migrate to `status = "blocked"`, populate `blocked_reason` with `category: "needs_human"`.
2. If `status === "paused"` AND `blocked_on` starts with `"escalation:"` → migrate to `status = "blocked"`, populate `blocked_reason` with `category: "retries_exhausted"`.
3. If `status === "paused"` AND (`pending_phase_transition` OR `pending_run_completion` exists) → leave as `paused`.
4. Write the migrated state back immediately (idempotent).

Edge case: if `paused` has BOTH `blocked_on = "escalation:..."` AND `pending_phase_transition`, `blocked` wins — the escalation is the actionable blocker. (This combination should not occur in practice.)

---

## Error Cases

1. **Double block:** If a `blocked` run receives a new block trigger (e.g., a second dispatch failure), the `blocked_reason` is overwritten with the latest condition. History of prior blocks is in `history.jsonl` and the decision ledger.

2. **Resume without resolution:** If the operator runs `step --resume` without actually fixing the underlying issue, the turn will re-fail and the run will return to `blocked`. This is intentional — the protocol does not gate on proof of resolution.

3. **Schema validation of persisted state:** `validateGovernedStateSchema()` must accept `"blocked"` as a legal status value. This is the only schema change.

4. **`blocked` + `current_turn = null`:** Legal. Occurs when `needs_human` accepted and cleared the turn. Recovery is `step` (new assignment), not `step --resume`.

5. **`blocked` + `current_turn` present:** Legal. Occurs for dispatch failure and retry exhaustion where the turn is preserved. Recovery is `step --resume`.

---

## Acceptance Tests

### Schema / Validation

1. `validateGovernedStateSchema()` accepts `status: "blocked"` with `blocked_on` and `blocked_reason` set.
2. `validateGovernedStateSchema()` rejects `status: "blocked"` with `blocked_on: null` or missing `blocked_reason` (invariant violation).
3. Config/state round-trip: write a `blocked` state, read it back, all fields preserved.

### Transition Tests

4. `acceptGovernedTurn()` with `status: "needs_human"` sets `state.status = "blocked"` (not `"paused"`).
5. `rejectGovernedTurn()` at max retries sets `state.status = "blocked"` (not `"paused"`).
6. `step --resume` from `blocked` with preserved turn sets `status = "active"` and clears `blocked_on` and `blocked_reason`.
7. `step` from `blocked` with `current_turn = null` sets `status = "active"` and proceeds to assignment.
8. Approval gates still produce `status = "paused"`: `acceptGovernedTurn()` with a gate requiring human approval sets `paused`, NOT `blocked`.
9. `approvePhaseTransition()` from `paused` works unchanged.
10. `approveRunCompletion()` from `paused` works unchanged.

### Migration Tests

11. Existing `state.json` with `status: "paused"`, `blocked_on: "human:scope clarification"` is migrated to `blocked` on read.
12. Existing `state.json` with `status: "paused"`, `blocked_on: "escalation:retries-exhausted:dev"` is migrated to `blocked` on read.
13. Existing `state.json` with `status: "paused"`, `pending_phase_transition` present is left as `paused`.
14. Migration is idempotent: reading the same file twice produces the same result.
15. Already-`blocked` state is not re-migrated.

### CLI Tests

16. `agentxchain status` with `status: "blocked"` renders the BLOCKED banner with recovery descriptor.
17. `agentxchain status` with `status: "paused"` and `pending_phase_transition` renders the approval prompt (unchanged behavior).

### Dispatch Failure Test

18. When `api_proxy` dispatch fails and the turn is preserved, `state.status` is set to `"blocked"` with `blocked_reason.category = "dispatch_error"`.

---

## Resolved Questions

1. **Peer status vs sub-state:** `blocked` remains a peer top-level status, not a sub-state of `active` (DEC-BLOCKED-001).

2. **Dispatch failure timing:** `blocked` is set only after retry exhaustion or a non-retryable dispatch failure surfaces out of the adapter. Adapter-local transient retries remain invisible to governed state (DEC-RETRY-001 + DEC-BLOCKED-006).

3. **`blocked_reason` optional vs required:** required. The implementation writes a structured `blocked_reason` object everywhere `status = "blocked"` is persisted (DEC-BLOCKED-007).

4. **`schema_version` bump:** stays at `"1.0"` in the current pre-release window. If this change ships after `1.0.0`, bump in a later cut (DEC-BLOCKED-008).
