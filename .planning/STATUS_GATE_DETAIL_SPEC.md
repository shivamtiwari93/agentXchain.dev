# Status Gate Detail Spec

## Purpose

Enhance `agentxchain status` to show gate requirements inline for the current phase's exit gate, so operators immediately understand what's needed to advance without cross-referencing the config.

## Behavior

When rendering gates in `status` output:

1. For the **active phase's exit gate** (from `config.routing[state.phase].exit_gate`):
   - If the gate is **not passed**, expand it with:
     - **Files:** list of `requires_files`, each colored green (exists) or red (missing), with `.planning/` prefix stripped for readability
     - **Needs:** human approval and/or verification pass, if configured
   - If the gate is **passed**, no expansion (compact line only)
2. For all **other gates** (not the active phase's exit gate): compact line only, no expansion

## Interface

No new CLI flags. The detail renders automatically in text mode. JSON mode (`--json`) is unchanged.

## Error Cases

- If `config.gates[gateId]` is undefined: no expansion (graceful fallback to compact)
- If `requires_files` is empty or missing: no "Files:" line
- If neither `requires_human_approval` nor `requires_verification_pass`: no "Needs:" line

## Acceptance Tests

- `AT-SGD-001`: active phase gate shows required file names
- `AT-SGD-002`: gate with `requires_human_approval` shows "human approval" in Needs line
- `AT-SGD-003`: non-active phase gates do not expand
- `AT-SGD-004`: passed gates do not expand
- `AT-SGD-005`: gate with `requires_verification_pass` shows "verification pass" in Needs line
