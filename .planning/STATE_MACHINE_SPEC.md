# Governed State Machine — v1 Spec

> Normative state-transition contract extracted from `cli/src/lib/governed-state.js`, `cli/src/lib/gate-evaluator.js`, and the governed CLI command surfaces.

---

## Purpose

Define the actual v1 governed run state machine as implemented today. This spec freezes:

- the persisted run states in `.agentxchain/state.json`
- the legal transitions between those states
- the turn lifecycle sub-states the operator experiences through `step`, `accept-turn`, `reject-turn`, and approval commands
- the guards that block transitions

This spec is intentionally descriptive, not aspirational. If code and prose disagree, the code wins until implementation is changed.

---

## Interface/Schema

### Run State Shape

The persisted run envelope is:

```ts
type GovernedRunState = {
  schema_version: "1.0";
  run_id: string | null;
  project_id: string;
  status: "idle" | "active" | "paused" | "completed" | "failed";
  phase: string;
  accepted_integration_ref?: string | null;
  current_turn: CurrentTurn | null;
  last_completed_turn_id?: string | null;
  blocked_on?: string | null;
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

### Persisted Turn Shape

```ts
type CurrentTurn = {
  turn_id: string;
  assigned_role: string;
  status: "running" | "retrying" | "failed";
  attempt: number;
  started_at: string;
  deadline_at: string;
  runtime_id: string;
  baseline?: unknown;
  last_rejection?: {
    turn_id: string;
    attempt: number;
    rejected_at: string;
    reason: string;
    validation_errors: string[];
    failed_stage: string;
  };
};
```

### Important Clarification

`state.status = "failed"` is part of the nominal schema surface, but it is **not currently produced** by the governed v1 writers. The implementation today uses:

- `state.status = "paused"` plus `current_turn.status = "failed"` for retry exhaustion
- `state.status = "completed"` for terminal success

So in v1 as implemented, run-level `failed` is reserved/unreached.

### Derived Turn Lifecycle States

The operator-visible turn lifecycle is richer than the persisted `current_turn.status` field:

```ts
type DerivedTurnLifecycle =
  | "assigned"
  | "dispatched"
  | "waiting"
  | "staged"
  | "validated"
  | "accepted"
  | "rejected_for_retry"
  | "escalated";
```

Only `running | retrying | failed` are persisted. The other states are command-flow phases derived from dispatch bundle presence, staged result presence, and validation outcome.

---

## Behavior

### 1. Legal Run States

| Run status | Required shape | Meaning |
|---|---|---|
| `idle` | `run_id = null`, `current_turn = null` | Scaffolded but not initialized |
| `active` | `run_id != null`, `current_turn` may be `null` or assigned | Run can assign, dispatch, or accept work |
| `paused` | `run_id != null` | Human approval, human escalation, or preserved failed turn blocks forward motion |
| `completed` | `current_turn = null`, `completed_at` set | Terminal successful run |
| `failed` | not currently emitted | Reserved for future terminal failure semantics |

### 2. Legal `(status, phase)` Pairs

All configured phases may coexist with `idle`, `active`, `paused`, or `completed`.

Constraints:

- `completed` preserves the last active phase; v1 does not write a special terminal phase
- `idle` is normally scaffolded with the routing entry phase, usually `planning`
- `failed` is reserved and therefore has no implemented legal pair set yet

### 3. Run-Level Transitions

| From | Trigger | Guard | To | Notes |
|---|---|---|---|---|
| `idle` | `initializeGovernedRun()` or `step` auto-init | state exists, not completed | `active` | creates `run_id`, budget envelope |
| `paused` | `initializeGovernedRun()` | allowed by implementation | `active` | used for migration/resume edge case |
| `active` | `assignGovernedTurn()` | no current turn, role exists, clean baseline passes | `active` | assigns `current_turn` |
| `active` | `acceptGovernedTurn()` with `status=needs_human` | staged result valid | `paused` | clears turn, sets `blocked_on=human:*` |
| `active` | `acceptGovernedTurn()` with gate awaiting approval | staged result valid, gate structurally passes, approval required | `paused` | sets pending approval object |
| `active` | `acceptGovernedTurn()` with final completion gate passing | final phase, completion requested | `completed` or `paused` | immediate completion or approval wait |
| `active` | `rejectGovernedTurn()` with retries left | current turn exists | `active` | same turn retained as retrying |
| `active` | `rejectGovernedTurn()` with retries exhausted | current turn exists | `paused` | escalation, preserved failed turn |
| `paused` | `approvePhaseTransition()` | pending transition exists and status paused | `active` | advances phase, clears blocker |
| `paused` | `approveRunCompletion()` | pending completion exists and status paused | `completed` | terminal success |
| `paused` | `step` resume path | paused with preserved failed/retrying turn | `active` | redispatches same turn |
| `completed` | any assign/init path | none | rejected | terminal in v1 |

### 4. Phase Transition Rules

Phase changes happen in exactly two places:

1. `acceptGovernedTurn()` when `evaluatePhaseExit()` returns `advance`
2. `approvePhaseTransition()` when a human-approved pending transition exists

Rules:

- no accepted turn, no phase change
- `phase_transition_request` is necessary but not sufficient
- gate failure accepts the turn but leaves phase unchanged
- `needs_human` short-circuits gate evaluation entirely
- `run_completion_request` takes precedence over phase-exit evaluation

### 5. Turn Lifecycle Sub-State Machine

| Derived state | Trigger | Persisted evidence |
|---|---|---|
| `assigned` | `assignGovernedTurn()` | `current_turn.status = "running"` |
| `dispatched` | `writeDispatchBundle()` plus adapter dispatch | dispatch bundle exists |
| `waiting` | adapter running or operator editing result | active turn retained |
| `staged` | `.agentxchain/staging/<turn_id>/turn-result.json` exists | staging file present |
| `validated` | `validateStagedTurnResult()` returns ok | ephemeral command result |
| `accepted` | `acceptGovernedTurn()` succeeds | history appended, turn cleared |
| `rejected_for_retry` | `rejectGovernedTurn()` before max retries | `current_turn.status = "retrying"` |
| `escalated` | `rejectGovernedTurn()` at max retries | `state.status = "paused"`, `current_turn.status = "failed"` |

### 6. Approval Semantics

Approval commands are strict:

- `approve-transition` succeeds only when `pending_phase_transition` exists and `status === "paused"`
- `approve-completion` succeeds only when `pending_run_completion` exists and `status === "paused"`
- v1 does not implement idempotent approvals

### 7. Routing Recommendation Semantics

`next_recommended_role` is advisory only.

- It is derived after acceptance, not assignment
- It uses `proposed_next_role` only when routing-legal for the current phase and not `human`
- It is cleared for `needs_human` and `blocked`
- It does not authorize assignment by itself

---

## Error Cases

- `initializeGovernedRun()` fails when state is missing or already `completed`.
- `assignGovernedTurn()` fails when run status is not `active`, a turn already exists, the role is unknown, or the clean-baseline check fails.
- `acceptGovernedTurn()` fails when there is no active turn, staged result validation fails, or observed artifact mismatches declared files.
- `rejectGovernedTurn()` fails when there is no active turn.
- `approvePhaseTransition()` fails when no pending transition exists or run is not paused.
- `approveRunCompletion()` fails when no pending completion exists or run is not paused.
- `step` refuses to assign into a completed run and refuses duplicate assignment without `--resume`.

---

## Acceptance Tests

1. From scaffolded `idle`, `initializeGovernedRun()` creates a `run_id`, sets `status = active`, and leaves `current_turn = null`.
2. `assignGovernedTurn()` from `active` assigns one turn with `attempt = 1` and rejects a second assignment while that turn exists.
3. An accepted turn with `status = completed` appends one row to `.agentxchain/history.jsonl`, appends accepted decisions to `.agentxchain/decision-ledger.jsonl`, clears the staging file, and sets `current_turn = null`.
4. An accepted turn with `status = needs_human` sets `state.status = paused`, clears `current_turn`, and records `blocked_on = human:*`.
5. A planning-phase accepted turn with `phase_transition_request = implementation` and missing gate files is accepted but keeps `phase = planning` and `status = active`.
6. A planning-phase accepted turn with required files present and `requires_human_approval = true` sets `pending_phase_transition`, keeps the old phase, and pauses the run.
7. `approvePhaseTransition()` from that paused state advances `phase`, clears the blocker, nulls `pending_phase_transition`, and marks the gate `passed`.
8. A rejection before max retries keeps the same `turn_id`, increments `attempt`, and sets `current_turn.status = retrying`.
9. A rejection at max retries pauses the run, preserves `current_turn`, sets `current_turn.status = failed`, and records `blocked_on = escalation:retries-exhausted:{role}`.
10. A final-phase accepted turn with `run_completion_request = true` and a passing non-human gate sets `state.status = completed` and `completed_at`.
11. A final-phase accepted turn with `run_completion_request = true` and `requires_human_approval = true` sets `pending_run_completion` and pauses instead of completing.
12. `approveRunCompletion()` from that paused state sets `status = completed`, clears `pending_run_completion`, and marks the final gate `passed`.

---

## Open Questions

1. Should v1.1 make run-level `status = "failed"` reachable, or should escalation continue to be represented only as `paused + current_turn.status = failed`?
2. Should dispatch and staging progress become persisted sub-state in `state.json`, or remain derived from command flow and filesystem evidence?
3. Should `initializeGovernedRun()` continue to reactivate a paused run, or should resumed runs be forced through explicit approval/recovery commands only?
