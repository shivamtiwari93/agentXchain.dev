> **Status:** shipped
> **Decision:** `DEC-VERIFY-TURN-001`

# Verify Turn Command Spec

## Purpose

Provide a first-party governed CLI surface for replaying a staged turn's declared verification evidence before acceptance.

This closes the gap between:

- `validate --mode turn` proving the staged result is structurally acceptable
- `accept-turn` trusting the agent-reported verification object

The command is not a second acceptance path and not a gate transition surface. It is a read-only reproducibility check on the staged turn's declared `verification.machine_evidence`.

## Interface

### Command

```bash
agentxchain verify turn [turn_id] [--json] [--timeout <ms>]
```

### Inputs

- Optional positional `turn_id`
  - If omitted, the command targets the single active governed turn.
  - If multiple active turns exist, the command fails and requires an explicit turn id.
- Optional `--json`
  - Emits structured replay results instead of text.
- Optional `--timeout <ms>`
  - Per-command replay timeout in milliseconds.
  - Default: `30000`

## Behavior

1. The command is available only on governed v4 repos.
2. The command resolves the target turn from the active turn set. It does not inspect historical accepted turns.
3. The command reads the staged result from `.agentxchain/staging/<turn_id>/turn-result.json`.
4. The command validates the staged result with the same validator used by governed acceptance, using the turn-scoped staging path.
5. If validation fails, the command exits non-zero and surfaces the validation stage plus errors. It does not run any replay commands.
6. Replay input comes only from `verification.machine_evidence[].command`.
   - `verification.commands` alone is not executable proof.
   - `verification.evidence_summary` alone is not executable proof.
7. Each replay command runs in the repo root using the local shell and the current workspace state.
8. The command compares actual exit code to declared `verification.machine_evidence[].exit_code` for each entry.
9. The command does not compare stdout/stderr text. Exit-code reproducibility is the frozen contract.
10. The command reports one of three overall outcomes:
    - `match`: every replayed command exited with the declared exit code
    - `mismatch`: at least one replayed command drifted, errored, or timed out
    - `not_reproducible`: the staged turn declared no `machine_evidence` commands to replay
11. Exit codes:
    - `0`: overall outcome is `match`
    - `1`: overall outcome is `mismatch` or `not_reproducible`
    - `2`: command/input/config error
12. The command never mutates state, history, ledgers, or gate status.

## Error Cases

- No `agentxchain.json` in scope
- Legacy or non-governed repo
- No active turn
- Multiple active turns without explicit `turn_id`
- Unknown active `turn_id`
- Missing staged result for the selected turn
- Invalid `--timeout`
- Staged turn result fails governed validation
- Replay command spawn error or timeout

## Acceptance Tests

1. **AT-VTURN-001**: `verify turn --json` on a valid staged result with one passing machine-evidence command exits `0` and reports `overall: "match"`.
2. **AT-VTURN-002**: `verify turn` text output defaults to the single active turn and prints declared status, overall outcome, and per-command exit-code comparison.
3. **AT-VTURN-003**: When the current workspace makes a declared passing command exit non-zero, the command exits `1` and reports `overall: "mismatch"`.
4. **AT-VTURN-004**: A staged result with no `verification.machine_evidence` exits `1` with `overall: "not_reproducible"`.
5. **AT-VTURN-005**: A staged result that honestly declares verification failure with matching non-zero exit code still exits `0` with `overall: "match"`.
6. **AT-VTURN-006**: Multiple active turns without a selected `turn_id` fail closed and list available turns.
7. **AT-VTURN-007**: Validation failure in the staged result exits `1`, names the failing validation stage, and does not attempt replay.
8. **AT-VTURN-008**: Legacy or missing-config repos fail closed with governed-surface guidance.

## Open Questions

1. Should a future slice support replaying accepted historical turns, or remain intentionally scoped to pre-acceptance staged results?
2. Should a future slice add optional stdout/stderr capture in JSON mode, or is exit-code reproducibility sufficient operator proof for v1?
