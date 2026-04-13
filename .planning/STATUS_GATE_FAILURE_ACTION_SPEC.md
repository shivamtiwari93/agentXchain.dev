# Status Gate Failure Action Spec

> `DEC-STATUS-NEXT-ACTION-001` — governed `status` must only recommend shipped commands

## Purpose

Prevent `agentxchain status` from telling governed users to run commands that do not exist.

The current bug is operator-facing: when a phase gate fails, `status` recommends `agentxchain assign <role>`, but governed mode does not ship an `assign` command. That makes the first recovery instruction false at exactly the point where the operator needs the CLI to be trustworthy.

## Interface

### Command surface

`agentxchain status`

### Affected section

`last_gate_failure` text rendering in governed status output

## Behavior

1. When `state.last_gate_failure` is present, `status` must render a recovery action that maps to a real governed command.
2. For phase-gate failures, the suggested recovery action is:
   - `agentxchain step --role <entry_role>` when the current phase has a configured `routing.<phase>.entry_role`
   - `agentxchain step --role <role>` when no concrete entry role can be resolved
3. The action text may explain that this continues work in the blocked phase, but it must not mention `assign`.
4. `status --json` remains unchanged. This slice is about human-facing text truth, not machine-readable payload shape.

## Error Cases

| Condition | Behavior |
|---|---|
| Current phase has no configured `entry_role` | Render `agentxchain step --role <role>` as the fallback placeholder command. |
| `last_gate_failure.phase` is absent or malformed | Keep the action command truthful; phase detail may remain `unknown`. |

## Acceptance Tests

- `AT-SGFA-001`: `status` prints `agentxchain step --role <entry_role>` for a persisted gate failure in a phase with a known entry role.
- `AT-SGFA-002`: `status` does not print `agentxchain assign` anywhere in the gate-failure recovery line.
- `AT-SGFA-003`: `status --json` still preserves `last_gate_failure` unchanged for automation consumers.

## Open Questions

None.

## Decisions

`DEC-STATUS-NEXT-ACTION-001`: governed `status` must only recommend commands that actually exist in the governed operator surface. Gate-failure recovery guidance uses `agentxchain step --role ...`, not the legacy/nonexistent `assign` wording.
