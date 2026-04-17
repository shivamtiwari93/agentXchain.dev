# Continuous-Mode Budget Enforcement Spec

**Decision:** `DEC-CONT-BUDGET-001`
**Status:** Draft → Implementation
**Depends on:** `DEC-VISION-CONTINUOUS-001`, `DEC-SCHEDULE-CONTINUOUS-001`, `DEC-BUDGET-ENFORCE-001`

---

## Purpose

Add cumulative session-level budget enforcement to continuous mode. The existing per-run budget (`per_run_max_usd`) caps spend within a single governed run. Continuous mode chains runs back-to-back — a session with `max_runs: 100` and `per_run_max_usd: 50` could spend $5,000 with no session-level cap.

This spec adds `per_session_max_usd` to gate total spend across all runs in a continuous session.

---

## Interface

### Config — CLI continuous options

```
agentxchain run --continuous --vision <path> --session-budget 200
```

`--session-budget <usd>` sets the cumulative session-level budget cap.

### Config — `agentxchain.json` run_loop.continuous

```json
{
  "run_loop": {
    "continuous": {
      "per_session_max_usd": 200.0
    }
  }
}
```

### Config — `schedules.<id>.continuous`

```json
{
  "schedules": {
    "factory": {
      "continuous": {
        "enabled": true,
        "vision_path": ".planning/VISION.md",
        "per_session_max_usd": 500.0
      }
    }
  }
}
```

### Session state — `.agentxchain/continuous-session.json`

New fields:

```json
{
  "per_session_max_usd": 200.0,
  "cumulative_spent_usd": 12.75,
  "budget_exhausted": false
}
```

---

## Behavior

### Cost accumulation

After each governed run completes in `advanceContinuousRunOnce()`, read `execution.result.state.budget_status.spent_usd` and add it to `session.cumulative_spent_usd`.

If `execution.result` is null (run failed to start), no cost is added.

### Pre-run budget check

Before starting a new governed run in `advanceContinuousRunOnce()`, check:

```
if per_session_max_usd is set AND cumulative_spent_usd >= per_session_max_usd:
  → session.status = 'completed'
  → session.budget_exhausted = true
  → return { status: 'completed', action: 'session_budget_exhausted', stop_reason: 'session_budget' }
```

This check happens after the terminal checks (max_runs, max_idle_cycles) and before the vision file validation. It is a pre-run gate, not a mid-run interruption — the per-run budget enforcement already handles mid-run spend caps.

### `local_cli` zero-cost runs

When using the `local_cli` adapter, `cost.usd` is 0. The session accumulator still works correctly — cumulative spend stays at 0, and a configured `per_session_max_usd` is never reached. This is correct behavior: local CLI runs incur no API cost.

### `api_proxy` cost-bearing runs

When using the `api_proxy` adapter, each turn accumulates `cost.usd` from real token billing. The per-run `budget_status.spent_usd` captures total spend for that run, and the session accumulator sums across runs.

### Status display

`agentxchain status` already shows continuous session state. Add cumulative budget display when `per_session_max_usd` is configured:

```
Session Budget: $12.75 / $200.00 (6.4%)
```

When a continuous session exits because the session budget is exhausted, the terminal stop reason and persisted schedule state must stay truthful:

- `run --continuous` must log `Session budget exhausted. Stopping.` rather than reusing the max-runs stop message.
- schedule-owned sessions must persist a distinct schedule-state status (`continuous_session_budget_exhausted`) instead of collapsing the stop into generic `continuous_completed`.

### Resolution options

```
resolveContinuousOptions(opts, config)
```

Add:
- `opts.sessionBudget` (CLI flag)
- `config.run_loop.continuous.per_session_max_usd` (config)
- CLI flag overrides config

### Validation

- `per_session_max_usd` must be a finite number > 0 when provided, or null/undefined to disable
- Schedule continuous config validates the same constraint

---

## Error Cases

1. **`per_session_max_usd` < `per_run_max_usd`**: Warning only — it's valid but means a run may exhaust the session budget partway through. The per-run budget handles graceful blocking within the run.
2. **`per_session_max_usd` is 0 or negative**: Validation error.
3. **`per_session_max_usd` is not a number**: Validation error.
4. **Run completes but `budget_status` is null/missing**: Treat as $0 cost (defensive — `local_cli` may not populate budget_status).

---

## Acceptance Tests

- `AT-CONT-BUDGET-001`: `run --continuous --session-budget 10 --max-runs 5` with api_proxy mock (each run costs $4). After 2 runs ($8 spent), third run pre-check finds $8 < $10 so starts. After 3rd run ($12 spent), 4th run pre-check finds $12 >= $10 → session stops with `session_budget_exhausted`. Assert: `cumulative_spent_usd: 12`, `budget_exhausted: true`, `runs_completed: 3`, `status: completed`.

- `AT-CONT-BUDGET-002`: `run --continuous --session-budget 100 --max-runs 2` with local_cli (zero cost). Both runs complete. Assert: `cumulative_spent_usd: 0`, `budget_exhausted: false`, `runs_completed: 2`, `status: completed`, `stop_reason: max_runs`.

- `AT-CONT-BUDGET-003`: Schedule continuous config with `per_session_max_usd: 50` validates correctly. Config with `per_session_max_usd: -1` rejected.

- `AT-CONT-BUDGET-004`: Status JSON includes `cumulative_spent_usd` and `per_session_max_usd` for active continuous sessions.

- `AT-CONT-BUDGET-005`: `executeContinuousRun()` logs `Session budget exhausted. Stopping.` when the session terminates on the budget gate and does not log the max-runs message.

- `AT-SDH-010`: `schedule daemon --max-cycles 3` with a cost-bearing continuous schedule preserves one schedule-owned session across polls, completes two runs, then stops before a third run starts when `per_session_max_usd` is reached. Assert: cycle 3 returns `action: session_budget_exhausted`, session `budget_exhausted: true`, run history length remains 2, `agentxchain status --json` shows the exhausted budget, and `schedule-state.json` records `last_status: continuous_session_budget_exhausted`.

- `AT-VCONT-010`: `run --continuous --session-budget nope` fails fast with `--session-budget must be a finite number greater than 0` and does not create `.agentxchain/continuous-session.json`.

---

## Open Questions

None — this is a narrow, well-bounded addition.
