# Budget Recovery E2E Spec

**Status:** Active
**Created:** 2026-04-07

## Purpose

Prove that a governed run blocked by `budget_exhausted` can recover through the real CLI after an operator raises the run budget with `agentxchain config --set`.

This slice also closes the truth gap in the recovery contract:

- the recovery path should use the shipped config command, not manual JSON editing
- budget state must reconcile against the current config before operator-facing commands render status or attempt assignment
- `budget_exhausted` has no retained turn, so the recovery command is `agentxchain resume`, not `step --resume`

## Interface

### Operator flow

1. A turn is accepted and exhausts `budget.per_run_max_usd`.
2. The run enters:
   - `state.status = "blocked"`
   - `state.blocked_on = "budget:exhausted"`
   - `state.blocked_reason.category = "budget_exhausted"`
3. The operator increases `budget.per_run_max_usd` with `agentxchain config --set budget.per_run_max_usd <usd>`.
4. The next CLI load reconciles:
   - `budget_status.remaining_usd = per_run_max_usd - spent_usd`
   - `budget_status.exhausted` cleared when remaining budget is positive
   - budget recovery guidance updated to the current config truth
5. The operator runs `agentxchain resume` to assign the next turn.

### Recovery guidance

- While still exhausted:
  - `Increase budget with agentxchain config --set budget.per_run_max_usd <usd>, then run agentxchain resume`
- After the config has enough headroom for a new reservation:
  - `Run agentxchain resume to assign the next turn`

## Behavior

### Budget reconciliation

Budget status is derived from:

- `spent_usd` in governed state
- `budget.per_run_max_usd` in the current normalized config

The persisted `remaining_usd` value is cacheable state, not immutable truth. If the operator changes the config limit, the runtime must recompute `remaining_usd` before:

- rendering `status`
- reassigning via `resume`
- any other governed load path that persists the updated state

### Reservation headroom

Recovery is only ready when the updated run budget leaves enough remaining budget for the next reservation check. Raising `per_run_max_usd` from negative remaining to a tiny positive number is not enough if the next turn reservation would still exceed available budget.

### Blocked state semantics

The exhausting turn remains accepted. No turn is retained for replay. The run stays blocked until the operator explicitly resumes it, even if the config change makes budget available again.

## Error Cases

- Config budget raised but still not enough for the next reservation:
  - `resume` must fail with the reservation error, not silently overdraw
- Config budget unchanged:
  - `status` and `resume` must still report the run as budget blocked
- Config budget removed (`per_run_max_usd = null`):
  - budget exhaustion guidance is no longer applicable; remaining budget becomes unbounded

## Acceptance Tests

1. Accepting a turn over the run limit blocks the run with `budget_exhausted`.
2. `status` reports the pre-recovery action through `config --set`.
3. After raising `per_run_max_usd`, loading state recalculates `remaining_usd` from current config.
4. After reconciliation, `status` reports resume-ready recovery guidance instead of telling the operator to edit the config again.
5. `agentxchain resume` succeeds after the raised budget leaves enough headroom for a new reservation.
6. The resumed run clears `blocked_on` / `blocked_reason` and assigns a new turn with a real dispatch bundle.

## Open Questions

None. Parallel reservation recovery remains out of scope.
