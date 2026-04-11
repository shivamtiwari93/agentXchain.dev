# Budget Enforcement Spec — Serial Governed Runs

**Status:** Active
**Created:** 2026-04-07
**Decision:** DEC-BUDGET-ENFORCE-001

## Purpose

Enforce `per_run_max_usd` budget limits at runtime so governed runs fail closed when the budget is exhausted, instead of silently continuing with negative remaining budget.

## Scope

Serial governed runs only. Parallel reservation arithmetic already exists and is not modified. This spec adds:

1. **Post-acceptance budget exhaustion check** — after deducting actual cost, if `remaining_usd <= 0`, the run transitions to `blocked` with `budget_exhausted` category.
2. **Pre-assignment budget-already-exhausted guard** — if budget is already exhausted (remaining <= 0, no active turns draining), reject assignment immediately.
3. **`on_exceed` policy enforcement** — respect `config.budget.on_exceed`:
   - `pause_and_escalate` (default): block run and require human intervention via `resume` after budget increase or explicit override.
   - `warn` (future): emit warning but allow continuation. Not implemented in this slice.
4. **Operator recovery guidance** — blocked reason includes spent/limit amounts and exact recovery command.
5. **Per-turn overrun warning** — if actual cost exceeds reservation, emit advisory warning in acceptance result.
6. **Budget reconciliation on config change** — `remaining_usd` is recomputed from current `agentxchain.json` budget before status/rendered recovery and before new assignment attempts.

## What This Does NOT Cover

- Parallel reservation budget enforcement (already works)
- Real-time mid-turn cost enforcement (would require adapter-level interruption)
- `warn` on_exceed policy (future slice)
- Budget increase CLI command (operator edits config manually)

## Interface

### Config (unchanged)
```json
{
  "budget": {
    "per_turn_max_usd": 2.0,
    "per_run_max_usd": 50.0,
    "on_exceed": "pause_and_escalate"
  }
}
```

### State Changes

`budget_status` gains an optional `exhausted` flag:
```json
{
  "budget_status": {
    "spent_usd": 52.30,
    "remaining_usd": -2.30,
    "exhausted": true,
    "exhausted_at": "2026-04-07T20:00:00.000Z",
    "exhausted_after_turn": "turn_abc123"
  }
}
```

### Blocked Reason (new category: `budget_exhausted`)
```json
{
  "category": "budget_exhausted",
  "recovery": {
    "typed_reason": "budget_exhausted",
    "owner": "human",
    "recovery_action": "Increase budget with agentxchain config --set budget.per_run_max_usd <usd>, then run agentxchain resume",
    "turn_retained": false,
    "detail": "Run budget exhausted: spent $52.30 of $50.00 limit ($2.30 over)"
  },
  "blocked_at": "2026-04-07T20:00:00.000Z",
  "turn_id": "turn_abc123"
}
```

### Acceptance Result (new field)
```json
{
  "budget_warning": "Actual cost $3.45 exceeded reservation $2.00 for this turn"
}
```

## Behavior

### 1. Post-Acceptance Exhaustion Check

After computing `remaining_usd` in `acceptGovernedTurn`:

```
if remaining_usd <= 0 AND on_exceed === 'pause_and_escalate':
  set status = 'blocked'
  set blocked_on = 'budget:exhausted'
  set blocked_reason = buildBlockedReason({ category: 'budget_exhausted', ... })
  set budget_status.exhausted = true
  set budget_status.exhausted_at = now
  set budget_status.exhausted_after_turn = turn_id
```

This fires AFTER the turn is accepted (the turn's work is preserved), but BEFORE the next turn can be assigned.

### 2. Pre-Assignment Exhaustion Guard

In `assignGovernedTurn`, before the existing reservation check:

```
if budget_status.remaining_usd != null AND budget_status.remaining_usd <= 0:
  return { ok: false, error: 'Cannot assign turn: run budget exhausted (spent $X of $Y limit)' }
```

This is a belt-and-suspenders guard. The post-acceptance check should have already blocked the run, but if state was manually edited or a race occurred, this prevents further spend.

### 3. Per-Turn Overrun Warning

In `acceptGovernedTurn`, after computing actual cost:

```
if reservation exists AND actual_cost > reserved_amount:
  add to warnings: 'Actual cost $X exceeded reservation $Y for this turn'
```

Advisory only. Does not block.

### 4. Budget Recovery Reconciliation

If the operator changes `budget.per_run_max_usd` through `agentxchain config --set budget.per_run_max_usd <usd>`, the runtime must recompute `budget_status.remaining_usd` from the persisted spend before rendering status or attempting a new assignment. A budget-exhausted run has no retained turn, so the recovery path is `agentxchain resume` once the raised limit leaves enough headroom for the next reservation.

## Acceptance Tests

1. **Budget exhaustion blocks run**: After accepting a turn whose cost exhausts the budget, `state.status === 'blocked'` and `state.blocked_reason.category === 'budget_exhausted'`.
2. **Exhausted run rejects new assignment**: `assignGovernedTurn()` returns `{ ok: false }` when `remaining_usd <= 0`.
3. **Recovery guidance is explicit**: `blocked_reason.recovery.recovery_action` contains the exact command and the specific budget numbers.
4. **Acceptance releases reservation**: After acceptance, `budget_reservations[turn_id]` is deleted and `spent_usd` reflects actual cost.
5. **Overrun warning emitted**: When actual cost exceeds reservation, acceptance result contains `budget_warning`.
6. **Budget not enforced when unconfigured**: When `per_run_max_usd` is null, no blocking occurs regardless of spend.
7. **Turn work is preserved**: The turn that exhausts the budget IS accepted (its artifacts are committed). Only subsequent turns are blocked.

## Open Questions

None. This is a narrow enforcement slice over existing budget tracking infrastructure.
