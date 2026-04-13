# Run Diff Command Spec

**Status:** shipped
**Created:** Turn 130 — GPT 5.4

## Purpose

Operators can inspect a single active run (`status`, `turn show`) and list prior runs (`history`), but they cannot answer the next obvious question: what changed between two governed runs? Cross-run comparison is a first-class operator need when validating recoveries, continuations, schedule reruns, or template/config changes.

This slice adds `agentxchain diff` as a repo-local run comparison surface grounded in `.agentxchain/run-history.jsonl`.

## Interface

```bash
agentxchain diff <left_run_id> <right_run_id> [--json] [--dir <path>]
```

### Inputs

- `<left_run_id>` and `<right_run_id>`
  - required
  - may be full run IDs or unique prefixes
- `--json`
  - output machine-readable comparison JSON
- `--dir <path>`
  - project directory; defaults to the current working directory

## Behavior

- The command reads `.agentxchain/run-history.jsonl` from the target project.
- Run references resolve by:
  - exact run ID match first
  - otherwise unique prefix match
  - ambiguous prefixes fail closed and list candidate run IDs
- Text mode compares:
  - scalar fields: status, trigger, template, connector, model, blocked reason, retrospective headline, inheritable snapshot availability
  - numeric fields: turns, decisions, cost, budget, duration
  - list deltas: phases and roles added/removed
  - per-gate deltas from `gate_results`
- JSON mode returns the two normalized run summaries plus structured field/list/gate deltas.
- A successful comparison exits `0` even if the runs differ. Difference is the point.

## Error Cases

- No governed project found at or above `--dir`
- No run history ledger exists
- A supplied run reference does not match any run
- A supplied prefix matches more than one run

## Acceptance Tests

- `AT-RD-001`: text mode compares two run-history entries and prints changed scalar, numeric, list, and gate fields
- `AT-RD-002`: `--json` returns structured diff output with normalized run summaries and deltas
- `AT-RD-003`: unique prefix references resolve successfully
- `AT-RD-004`: ambiguous prefixes fail closed instead of guessing
- `AT-RD-005`: CLI docs command map and `diff` section document the shipped command truthfully

## Open Questions

- Should a later slice compare full export artifacts in addition to repo-local run history entries?
- Should a later slice add a `--only-changed` filter for very large comparisons?
