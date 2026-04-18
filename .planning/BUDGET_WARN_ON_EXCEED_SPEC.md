# Budget `on_exceed: "warn"` Policy Spec

**Status:** Shipped
**Decision:** DEC-BUDGET-WARN-001
**Depends on:** DEC-BUDGET-ENFORCE-001, DEC-BUDGET-CONFIG-001–003, DEC-CONFIG-GOV-001–003

---

## Purpose

When `budget.on_exceed` is `"pause_and_escalate"` (the only current mode), the run blocks immediately once budget is exhausted. This is safe-by-default but too aggressive for operators who want budget awareness without hard stops — especially in lights-out or daemon-scheduled runs where blocking requires human intervention.

`on_exceed: "warn"` is a lighter enforcement mode: the run continues past budget exhaustion but emits observable warnings through events, notifications, and status surfaces so operators can intervene if they choose.

---

## Interface

### Config

```json
{
  "budget": {
    "per_turn_max_usd": 2.0,
    "per_run_max_usd": 10.0,
    "on_exceed": "warn"
  }
}
```

Valid `on_exceed` values: `"pause_and_escalate"` (default), `"warn"`.

Set via CLI: `agentxchain config --set budget.on_exceed warn`

---

## Behavior

### Post-acceptance (turn exhausts budget)

When `remaining_usd <= 0` and `on_exceed === "warn"`:

1. **Do NOT block the run.** Status remains `active`.
2. **Set `budget_status.exhausted = true`**, `exhausted_at`, and `exhausted_after_turn` — same truth signals as `pause_and_escalate`.
3. **Set `budget_status.warn_mode = true`** — indicates the run is operating past budget in warn mode.
4. **Emit a `budget_warning` event** to `.agentxchain/events.jsonl` with type `budget_exceeded_warn`.
5. **Emit a notification** via the existing webhook/notification surface.
6. **Return `budget_warning` in the acceptance result** (advisory, same field as reservation overruns).

### Pre-assignment guard

When `on_exceed === "warn"` and budget is exhausted:

1. **Allow the assignment.** Do not reject.
2. **Add a warning** to the assignment result: `"Budget exhausted ($X.XX of $Y.YY limit). Run continues in warn mode per on_exceed policy."`.

### Status display

When `budget_status.warn_mode === true`:

- `status` shows a `[OVER BUDGET]` indicator next to the budget line.
- `status --json` includes `budget_status.warn_mode: true`.

### Recovery

No recovery is needed — the run is not blocked. If the operator wants to stop, they can run `agentxchain escalate --reason "budget exceeded"` manually or change the policy to `pause_and_escalate`.

---

## Error Cases

1. **Invalid `on_exceed` value** — validation rejects anything except `"pause_and_escalate"` or `"warn"`. Error message lists valid values.
2. **Switching from `warn` to `pause_and_escalate` mid-run** — if the run is already past budget and the operator changes the policy, the next `loadProjectState` reconciliation will see `exhausted === true` and `on_exceed === "pause_and_escalate"`, and the pre-assignment guard will block the next turn. This is correct and intentional.
3. **Switching from `pause_and_escalate` to `warn` while blocked** — the run remains blocked until `resume` is called. The new policy only applies to future exhaustion events. This is correct: `warn` changes future behavior, not past blocking decisions.

---

## Acceptance Tests

1. **AT-1: Warn mode allows run to continue past budget exhaustion.**
   - Config: `on_exceed: "warn"`, `per_run_max_usd: 5.0`
   - Action: Accept turn with cost $6.00
   - Assert: `state.status === "active"`, `state.budget_status.exhausted === true`, `state.budget_status.warn_mode === true`

2. **AT-2: Warn mode emits budget_warning in acceptance result.**
   - Same setup as AT-1
   - Assert: `result.budget_warning` includes "budget exhausted" language

3. **AT-3: Pre-assignment succeeds in warn mode even when budget exhausted.**
   - Setup: Exhaust budget with warn mode
   - Action: Assign a new turn
   - Assert: `assign.ok === true`, `assign.warnings` includes budget-exhausted text

4. **AT-4: Cumulative warn-mode tracking across multiple turns past budget.**
   - Setup: `on_exceed: "warn"`, `per_run_max_usd: 5.0`
   - Action: Accept turn 1 ($4.00), accept turn 2 ($3.00), accept turn 3 ($2.00)
   - Assert: After turn 2, `exhausted === true` and `warn_mode === true` and `status === "active"`. After turn 3, same — run is still active.

5. **AT-5: Switching from warn to pause_and_escalate blocks next assignment.**
   - Setup: Exhaust budget in warn mode
   - Action: Change config to `on_exceed: "pause_and_escalate"`, try to assign
   - Assert: Assignment is rejected because budget is exhausted and policy is now `pause_and_escalate`

6. **AT-6: Config validation accepts "warn".**
   - Action: `validateV4Config` with `on_exceed: "warn"`
   - Assert: `result.ok === true`

---

## Open Questions

None. The scope is narrow: add `"warn"` as a valid policy, skip the blocking path, emit warnings.
