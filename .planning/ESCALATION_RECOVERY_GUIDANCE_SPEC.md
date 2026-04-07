# Escalation Recovery Guidance Spec

**Status:** shipped

## Purpose

Escalation recovery guidance was directionally correct but not operationally truthful.

Two defects existed:

1. retained-turn escalations on `manual` runtimes recommended `agentxchain step --resume`, which dispatches and then waits for a staged result instead of returning immediately with a fresh bundle
2. targeted escalations with multiple retained turns did not include the required `--turn <id>` recovery target

This slice makes escalation recovery guidance runtime-aware and target-aware without changing the underlying recovery mechanics.

## Interface

### Recovery Descriptor

For `typed_reason = operator_escalation` and `typed_reason = retries_exhausted`, the recovery descriptor must derive the command from retained-turn context:

- retained `manual` turn: `agentxchain resume`
- retained non-manual turn: `agentxchain step --resume`
- no retained turn: `agentxchain resume`
- multiple retained turns with a targeted escalation: append `--turn <id>` to the suggested command

The full operator-facing string remains:

```text
Resolve the escalation, then run agentxchain <command>
```

### Persisted State

New escalation blocks must persist the corrected `recovery_action` in:

- `state.blocked_reason.recovery.recovery_action`
- `state.escalation.recovery_action`

Previously persisted blocked states must be reconciled on load so `status`, `report`, and other read surfaces stop repeating stale guidance.

## Behavior

### 1. Runtime-aware command selection

Escalation recovery guidance uses the targeted retained turn's runtime:

- `manual` => recommend `resume`
- `local_cli`, `api_proxy`, `mcp` => recommend `step --resume`

This is a guidance change, not a behavior change. Both `resume` and `step --resume` may still clear blocked escalation states where already supported.

### 2. Run-level escalation guidance

Run-level operator escalations should recommend `agentxchain resume`, not `agentxchain step`. `resume` is the truthful non-waiting recovery surface already proven in subprocess E2E.

### 3. Targeted multi-turn guidance

When an escalation targets one retained turn while other active turns still exist, the recovery action must include `--turn <id>` so the suggested command is directly executable.

### 4. Reconciliation

If an older blocked escalation state contains stale recovery guidance, load-time reconciliation must rewrite the persisted recovery descriptor and escalation metadata to the current truthful command.

## Error Cases

- If the targeted turn cannot be resolved from `blocked_reason.turn_id` / `escalation.from_turn_id`, fall back to the prior generic escalation guidance instead of inventing a turn id.
- Explicit operator overrides via `agentxchain escalate --action ...` are preserved as authored and are not rewritten by runtime-aware defaults.

## Acceptance Tests

- `AT-ERG-001`: retained operator escalation on a `manual` runtime recommends `agentxchain resume`.
- `AT-ERG-002`: retained operator escalation on a non-manual runtime still recommends `agentxchain step --resume`.
- `AT-ERG-003`: run-level operator escalation recommends `agentxchain resume`.
- `AT-ERG-004`: targeted escalation with multiple retained turns includes `--turn <id>` in the recovery action.
- `AT-ERG-005`: load-time reconciliation rewrites stale persisted escalation recovery guidance to the current truthful command.

## Open Questions

1. This slice only corrects escalation guidance. Other retained-turn blocked states may deserve the same runtime-aware treatment later.
