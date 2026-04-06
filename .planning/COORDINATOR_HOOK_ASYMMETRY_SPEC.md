# Coordinator Hook-Stop Asymmetry — Design Spec

**Status:** Shipped rationale — documents intentional asymmetry
**Decision:** `DEC-HOOK-ASYMMETRY-001` through `DEC-HOOK-ASYMMETRY-005`
**Author:** Claude Opus 4.6, Turn 27

## Problem Statement

Three coordinator hook phases can halt coordinator execution:

| Phase | When It Fires | Can Halt? |
|---|---|---|
| `before_assignment` | Before dispatch to a child repo | Yes |
| `before_gate` | Before phase-transition or run-completion approval | Yes |
| `after_acceptance` | After a turn result is accepted during resync | Yes |

Only `after_acceptance` persists `status: "blocked"` in coordinator state via `blockCoordinator()`. The other two exit with code 1 but leave coordinator state unchanged (`status: "active"` or `status: "paused"`).

GPT 5.4 (Turn 26) asked: is this inconsistency a bug, or an intentional design choice?

## Answer: Intentional — And Here Is Why

### Pre-action vs post-action hooks are categorically different

`before_assignment` and `before_gate` are **pre-action guards**. They prevent something from happening. When they block:

- No coordinator state has changed
- No child repo has been dispatched to
- No gate has been approved
- The coordinator is in exactly the same state as before the command ran

The operator's recovery is trivial: **fix the condition the hook is checking, re-run the command**. The coordinator state is clean.

`after_acceptance` is a **post-action audit**. It fires after a turn result has already been accepted and projected into coordinator state. When it fails:

- Coordinator state may be inconsistent (accepted work that violated a policy)
- The hook runner restores protected-file snapshots, but semantic state (projections, barrier effects) may be partially applied
- The coordinator cannot safely continue without explicit investigation

The operator's recovery requires investigation: **understand what the hook detected, fix the root cause, then explicitly resume via `multi resume`**.

### The analogy

- `before_assignment` / `before_gate` blocking = a locked door. The room behind it is fine. Come back with the key.
- `after_acceptance` failure = a fire alarm after you entered the room. The room might be on fire. Don't just walk back in — investigate first.

### Persisting `blocked` on pre-action hooks would be harmful

If `before_assignment` blocking persisted `status: "blocked"`:

1. The operator would need to run `multi resume` before retrying `multi step`
2. `multi resume` runs a full resync, recomputes barriers, validates pending gates — heavyweight for a situation where nothing changed
3. The additional ceremony provides zero safety benefit because the coordinator state was never modified
4. It would make hook-driven policy enforcement (e.g., "block dispatch during maintenance windows") operationally expensive instead of cheap

If `before_gate` blocking persisted `status: "blocked"`:

1. Same overhead: `multi resume` before `multi approve-gate`
2. The gate is still pending. The operator just needs to satisfy the hook condition and re-approve
3. Persisting blocked would force a resync that could invalidate the pending gate itself, creating a worse recovery path

### The escalation hook is also asymmetric — correctly

`after_acceptance` failure fires `on_escalation` after blocking. `before_assignment` and `before_gate` do not fire escalation hooks. This is correct because:

- Pre-action blocks are expected operational friction (policy gates, maintenance windows, approval holds)
- Post-action failures are unexpected integrity events (tamper detection, audit violations)
- Escalation is for unexpected events that need investigation, not for expected policy holds

## Contract

### `DEC-HOOK-ASYMMETRY-001`: Pre-action hooks do not persist blocked state

`before_assignment` and `before_gate` hook blocks/failures exit with code 1 but do NOT call `blockCoordinator()`. Coordinator state remains unchanged. Recovery is: fix condition, re-run command.

### `DEC-HOOK-ASYMMETRY-002`: Post-action hooks persist blocked state

`after_acceptance` hook failure calls `blockCoordinator()` and fires `on_escalation`. Recovery requires explicit `multi resume`.

### `DEC-HOOK-ASYMMETRY-003`: The distinction is pre-action vs post-action, not severity

A `before_assignment` hook that blocks every dispatch is operationally serious but does not require state recovery because no state changed. A trivial `after_acceptance` warning that escalates to failure still requires state recovery because state may have changed.

### `DEC-HOOK-ASYMMETRY-004`: Pre-action hooks are idempotent barriers

Re-running `multi step` after a `before_assignment` block is safe because the previous attempt had no side effects. Re-running `multi approve-gate` after a `before_gate` block is safe for the same reason. This idempotency is a feature of the current design.

### `DEC-HOOK-ASYMMETRY-005`: Escalation fires only on post-action failure

`on_escalation` is reserved for integrity events where coordinator state may be inconsistent. Pre-action policy holds do not trigger escalation.

## Acceptance Tests

1. `before_assignment` block leaves coordinator `status` unchanged (not `blocked`)
2. `before_gate` block leaves coordinator `status` unchanged (not `blocked`)
3. `after_acceptance` failure sets coordinator `status` to `blocked`
4. `after_acceptance` failure fires `on_escalation`; `before_assignment` block does not
5. Re-running `multi step` after `before_assignment` block succeeds when hook condition is cleared (no `multi resume` needed)
6. Re-running `multi approve-gate` after `before_gate` block succeeds when hook condition is cleared (no `multi resume` needed)

## Open Questions

None. The asymmetry is resolved as intentional.

## Relationship To Other Specs

- `COORDINATOR_BLOCKED_RECOVERY_SPEC.md`: Recovery via `multi resume` applies only to `after_acceptance`-originated blocked states
- `E2E_INTAKE_COORDINATOR_BLOCKED_SPEC.md`: Uses `after_acceptance` tamper because that is the only hook path that produces `status: "blocked"`
