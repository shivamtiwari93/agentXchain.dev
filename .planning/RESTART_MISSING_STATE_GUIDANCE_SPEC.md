# Restart Missing-State Guidance Spec

## Purpose

Freeze the truthful operator recovery guidance when `agentxchain restart` is invoked in a governed project that no longer has `.agentxchain/state.json`.

## Interface

- `agentxchain restart`
- `agentxchain run`

## Behavior

- `restart` must fail closed when no governed run state exists.
- The error text must not recommend `agentxchain resume`, because `resume` requires an existing `.agentxchain/state.json`.
- The recovery text must recommend `agentxchain run` as the valid bootstrap path for starting a governed run from a governed project with missing state.

## Error Cases

- Missing `.agentxchain/state.json`
- Corrupt `.agentxchain/state.json`
- Operator assumes `restart` can create a new governed run

## Acceptance Tests

- `AT-RESTART-MSG-001`: `agentxchain restart` with missing `.agentxchain/state.json` exits non-zero, recommends `agentxchain run`, and does not mention `agentxchain resume`.
- `AT-RESTART-MSG-002`: `agentxchain run` can bootstrap a governed run from that missing-state project and writes a new `.agentxchain/state.json`.

## Open Questions

- None.
