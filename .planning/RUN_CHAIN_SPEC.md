# Run Chain Spec

> Auto-chaining governed runs for lights-out operation.

## Purpose

Enable AgentXchain to automatically chain governed runs — when a run completes, start a new run that inherits context from the previous one. This removes the manual `--continue-from` step and enables true lights-out software factory operation.

## Interface

```
agentxchain run --chain [--max-chains N] [--chain-on STATUS] [--chain-cooldown SECONDS]
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--chain` | `false` | Enable auto-chaining |
| `--max-chains` | `5` | Maximum number of continuation runs (total runs = max-chains + 1 initial) |
| `--chain-on` | `completed` | Comma-separated terminal statuses that trigger chaining: `completed`, `blocked`, `max_turns_reached` |
| `--chain-cooldown` | `5` | Seconds to wait between chained runs |

### Config

Chaining can also be configured in `agentxchain.json`:

```json
{
  "run_loop": {
    "chain": {
      "enabled": false,
      "max_chains": 5,
      "chain_on": ["completed"],
      "cooldown_seconds": 5
    }
  }
}
```

CLI flags override config values.

## Behavior

### Chain Loop

1. Execute initial governed run normally via `executeGovernedRun()`.
2. When the run terminates, check whether the terminal status is in `chain_on`.
3. If yes, and chains remaining > 0:
   a. Wait `cooldown_seconds`.
   b. Build inherited context from the just-completed run.
   c. Start a new governed run with:
      - `--continue-from <previous_run_id>`
      - `--inherit-context`
      - Same `--auto-approve` setting as the initial run
      - Same `--max-turns` setting
   d. Decrement remaining chains.
   e. Go to step 2.
4. If the terminal status is NOT in `chain_on`, stop.
5. If chains remaining <= 0, stop with `chain_limit_reached` reason.

### Chain History

Each chain iteration produces its own governed run with:
- Unique `run_id`
- Provenance pointing to the previous run (`trigger: "continuation"`)
- Inherited context from the previous run
- Its own governance report

The chain module tracks:
```json
{
  "chain_id": "chain-<uuid>",
  "started_at": "ISO8601",
  "runs": [
    {
      "run_id": "...",
      "status": "completed",
      "turns": 5,
      "duration_ms": 12000,
      "provenance_trigger": "manual",
      "parent_run_id": null,
      "inherited_context_summary": null
    },
    {
      "run_id": "...",
      "status": "completed",
      "turns": 3,
      "duration_ms": 8000,
      "provenance_trigger": "continuation",
      "parent_run_id": "gov-abc123",
      "inherited_context_summary": {
        "parent_run_id": "gov-abc123",
        "parent_status": "completed",
        "inherited_at": "ISO8601",
        "parent_roles_used": ["pm", "dev", "qa"],
        "parent_phases_completed_count": 3,
        "recent_decisions_count": 2,
        "recent_accepted_turns_count": 3
      }
    }
  ],
  "total_turns": 8,
  "total_duration_ms": 20000,
  "terminal_reason": "completed" | "chain_limit_reached" | "non_chainable_status" | "operator_abort"
}
```

This summary is written to `.agentxchain/reports/chain-<chain_id>.json`.
Each run entry must expose enough lineage to audit the chain without reopening live state:
- `provenance_trigger`
- `parent_run_id`
- `inherited_context_summary` for continuation runs

### SIGINT Handling

- First SIGINT: finish current turn, stop current run, do NOT chain.
- Second SIGINT: hard exit.
- Each governed run must remove its temporary SIGINT listener before the next chained run starts. Chaining may not accumulate multiple listeners inside one long-lived process.

### Terminal Output

```
agentxchain run --chain
  Chain mode: enabled (max 5, on: completed, cooldown: 5s)

  ── Chain run 1/6 ──────────────────────────────────────────
  [normal run output]
  ─── Run Summary ───
  Status:  completed
  Turns:   5

  Chain: run completed → starting continuation (4 remaining)...
  Waiting 5s...

  ── Chain run 2/6 ──────────────────────────────────────────
  [normal run output]
  ...

  ─── Chain Summary ───
  Total runs:   3
  Total turns:  12
  Duration:     45s
  Terminal:     chain_limit_reached
```

## Error Cases

1. **Non-governed project**: Same as `run` — error and exit.
2. **Chain with manual roles**: Chaining skips manual roles (same as `run`).
3. **Chain with blocked run not in chain_on**: Stop chaining, report last run's blocked reason.
4. **Inherited context build failure**: Log warning, continue chaining without inherited context (degraded but not broken).
5. **Parent run ID not found in run-history**: Attempt to repair the advisory run-history entry from the just-completed terminal state, then retry validation once. If it still cannot be validated, stop chaining with error.

## Acceptance Tests

- `AT-CHAIN-001`: `--chain` with 2 completable runs chains automatically (2 run IDs in chain report).
- `AT-CHAIN-002`: `--chain --max-chains 1` stops after 1 continuation (total 2 runs).
- `AT-CHAIN-003`: `--chain --chain-on blocked` chains on blocked status.
- `AT-CHAIN-004`: `--chain` with run that blocks does NOT chain when `chain_on` is default `completed`.
- `AT-CHAIN-005`: Chain report written to `.agentxchain/reports/chain-*.json` with lineage and inherited-context summaries for child runs.
- `AT-CHAIN-006`: Config-based chaining (`run_loop.chain.enabled: true`) works without CLI flags.
- `AT-CHAIN-007`: CLI flags override config values.
- `AT-CHAIN-008`: SIGINT during chained run prevents further chaining.
- `AT-CHAIN-009`: Repeated chained runs do not leak SIGINT listeners across `executeGovernedRun()` invocations.

## Open Questions

None — this is a straightforward composition of existing primitives (`executeGovernedRun`, `buildInheritedContext`, `validateParentRun`).
