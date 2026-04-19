# Governed Budget Config Validation

**Status:** Shipped
**Created:** 2026-04-11

## Purpose

Governed repos already expose `budget` as a first-class operator surface, but the config validator was not enforcing any schema for it. That left two product-truth failures:

1. invalid budget edits like `agentxchain config --set budget.per_turn_max_usd banana` were accepted
2. budget recovery guidance still told operators to hand-edit JSON even though `agentxchain config --set` now exists

This slice makes budget edits fail closed and routes the simple recovery path through the shipped CLI command instead of stale manual editing guidance.

## Interface

Supported governed budget mutations:

```bash
agentxchain config --set budget.per_turn_max_usd 2
agentxchain config --set budget.per_run_max_usd 50
agentxchain config --set budget.cost_rates.gpt-4o.input_per_1m 2.5
agentxchain config --set budget.cost_rates.gpt-4o.output_per_1m 10
```

Budget recovery guidance:

```bash
agentxchain config --set budget.per_run_max_usd <usd>
agentxchain resume
```

## Behavior

1. `validateV4Config()` must validate `budget` when present.
2. `budget.per_turn_max_usd` and `budget.per_run_max_usd` must be finite numbers greater than `0` when provided.
3. If both budget limits are provided, `per_turn_max_usd` must be less than or equal to `per_run_max_usd`.
4. `budget.on_exceed` currently supports only `pause_and_escalate`. `warn` remains future scope and must fail closed instead of being silently accepted.
5. `budget.cost_rates` must be an object keyed by model name where each value provides finite numeric `input_per_1m` and `output_per_1m` fields, each greater than or equal to `0`.
6. Recovery guidance for `budget_exhausted` must point operators at `agentxchain config --set budget.per_run_max_usd <usd>` rather than manual `agentxchain.json` edits.

## Error Cases

- `budget` is not an object
- a budget limit is missing, non-numeric, `NaN`, infinite, or `<= 0`
- `per_turn_max_usd` exceeds `per_run_max_usd`
- `budget.on_exceed` is set to an unsupported mode such as `warn`
- `budget.cost_rates` is not an object
- a `cost_rates` entry is missing numeric `input_per_1m` or `output_per_1m` values

## Acceptance Tests

- `AT-BCV-001`: `validateV4Config()` rejects non-numeric `budget.per_turn_max_usd`
- `AT-BCV-002`: `validateV4Config()` rejects `per_turn_max_usd > per_run_max_usd`
- `AT-BCV-003`: `validateV4Config()` rejects unsupported `budget.on_exceed`
- `AT-BCV-004`: `validateV4Config()` rejects malformed `budget.cost_rates` entries
- `AT-BCV-005`: `config --set budget.per_turn_max_usd banana` fails closed and leaves the governed config unchanged
- `AT-BCV-006`: budget recovery docs and subprocess E2E route recovery through `agentxchain config --set budget.per_run_max_usd <usd>`

## Open Questions

Complex structural budget editing is still out of scope. Dot-path `config --set` is sufficient for scalar budget limits and individual `cost_rates` fields; a richer budget subcommand can be evaluated later if operators need bulk mutation ergonomics.
