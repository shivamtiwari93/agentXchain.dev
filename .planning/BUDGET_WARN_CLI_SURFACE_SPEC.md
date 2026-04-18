# Budget Warn CLI Surface Spec

**Status:** Shipped
**Decision:** DEC-BUDGET-WARN-003
**Depends on:** DEC-BUDGET-WARN-001, DEC-CONFIG-GET-001, DEC-RUN-EVENTS-001

---

## Purpose

`budget.on_exceed: "warn"` already exists in state-level behavior, but the operator-facing CLI was still dropping the advisory on the real command path:

- `agentxchain accept-turn` ignored `result.budget_warning`
- `agentxchain step`, `resume`, and `restart` ignored `assignGovernedTurn(...).warnings`

That is not acceptable. If warn mode is a shipped operator policy, the CLI must surface the warning at the moment the operator crosses or continues past budget, not force them to discover it later by opening raw state.

---

## Interface

### Acceptance surface

When `agentxchain accept-turn` accepts a turn that exhausts budget in warn mode, the command prints a visible advisory line:

```text
Budget warning: Budget exhausted: spent $6.00 of $5.00 limit ($1.00 over). Run continues in warn mode.
```

### Assignment surfaces

When budget is already exhausted in warn mode and the next turn is assigned through:

- `agentxchain step`
- `agentxchain resume`
- `agentxchain restart`

the command prints each assignment warning as:

```text
Warning: Budget exhausted (spent $6.00 of $5.00 limit). Run continues in warn mode per on_exceed policy.
```

### Other observable surfaces

The CLI-visible advisory must remain consistent with:

- `agentxchain status`
- `agentxchain status --json`
- `agentxchain events --json`
- `agentxchain config --get budget.on_exceed`

---

## Behavior

1. `accept-turn` prints `budget_warning` when present and still exits successfully.
2. Assignment-capable commands print all `assignGovernedTurn(...).warnings` after a successful assignment and before the operator continues.
3. The advisory is additive, not blocking. The run remains active in warn mode.
4. Status continues to show `[OVER BUDGET]`, JSON status continues to expose `budget_status.warn_mode`, and events continue to include `budget_exceeded_warn`.

---

## Error Cases

1. If warn mode is not configured, no warn-mode advisory should be printed.
2. If assignment fails for a real blocking reason, the existing failure path still wins; warnings are only printed after a successful assignment.
3. If `accept-turn` fails validation or acceptance, the warn-mode advisory must not be printed as if the turn succeeded.

---

## Acceptance Tests

1. **AT-BWC-001: `accept-turn` prints the warn-mode budget advisory on the real CLI path.**
2. **AT-BWC-002: `status` and `status --json` show over-budget warn-mode state after the warned acceptance.**
3. **AT-BWC-003: `config --get budget.on_exceed` returns `warn` for the same fixture.**
4. **AT-BWC-004: `events --json --type budget_exceeded_warn` returns the warn event emitted by the same acceptance.**
5. **AT-BWC-005: `resume --role <role>` prints the pre-assignment warn-mode advisory when assigning the next turn after exhaustion.**

---

## Open Questions

None. The scope is narrow: make the already-shipped warn-mode policy truthful on the actual CLI surfaces and prove it with subprocess E2E coverage.
