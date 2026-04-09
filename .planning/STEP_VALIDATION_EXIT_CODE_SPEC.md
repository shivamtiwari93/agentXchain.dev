# Step Validation Exit Code Spec

## Purpose

`agentxchain step` is automation-facing. When dispatch succeeds but the staged turn result fails validation, returning exit code `0` is a false success signal. Operators can still recover manually, but scripts, proof runs, and CI need a non-zero exit to distinguish "turn accepted" from "turn retained and broken".

This spec defines the exit-code contract for validation failures in `step`.

## Interface

- Command: `agentxchain step [--role <role>] [--resume] [--turn <id>] [--auto-reject]`
- Success exit code:
  - `0` when the turn is accepted
- Failure exit codes:
  - `1` when dispatch, hook execution, validation, acceptance, or recovery action fails

## Behavior

1. `step` still prints the validation stage and every validation error when a staged turn result is invalid.
2. Without `--auto-reject`:
   - the turn remains retained for operator recovery
   - `step` prints the recovery options (`accept-turn`, `reject-turn`, `step --auto-reject`)
   - `step` exits with code `1`
3. With `--auto-reject`:
   - `step` rejects/retries or escalates as before
   - successful rejection/retry flow keeps the existing exit behavior
4. Hook-blocked validation paths are unchanged: they already exit non-zero.
5. Docs and proof scripts must not rely on stdout parsing to detect validation failure once this ships.

## Error Cases

- Invalid staged turn-result JSON
- Schema failure
- Assignment mismatch
- Artifact contract failure
- Verification failure
- Protocol failure

All of the above are validation failures and must cause exit code `1` when `step` returns control without accepting the turn.

## Acceptance Tests

- [x] A resumed turn with an invalid staged result exits `1`, prints `Validation failed`, and retains the turn.
- [x] Remote-agent naive-service E2E expects exit `1` for invalid decision IDs and missing review objections.
- [x] CLI docs state that validation-failed `step` runs retain the turn and exit non-zero.
- [x] Model-backed remote-agent proof no longer depends on the old exit-0 bug for failure detection.

## Open Questions

None.
