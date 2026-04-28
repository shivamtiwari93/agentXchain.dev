# BUG-102 Expected Non-Zero Verification Evidence Spec

## Purpose

Allow full-auto acceptance to handle deliberate negative CLI checks without manual operator recovery. A QA turn may legitimately prove error handling by running commands expected to exit non-zero. The validator must distinguish those expected failures from accidental verification failures.

## Interface

- `verification.machine_evidence[].expected_exit_code?: number`
  - Optional integer.
  - When present, it declares the exit code expected for that command.
- `verification.evidence_summary`
  - May also explicitly declare expected negative checks using wording such as `--first-type STRING exits 1`.

## Behavior

- `verification.status: "pass"` with all `machine_evidence[].exit_code === 0` remains valid.
- `verification.status: "pass"` with a non-zero `exit_code` is valid only when:
  - `expected_exit_code` is an integer and equals `exit_code`, or
  - `evidence_summary` explicitly names the command or recognized command snippet and says it exits that code.
- The validator emits a warning when a passing turn includes expected non-zero commands.
- Dispatch bundle instructions tell agents to use `expected_exit_code` for raw negative-case commands.

## Error Cases

- A non-zero `exit_code` under `verification.status: "pass"` without an explicit expected-failure declaration fails validation.
- A provided `expected_exit_code` that is not an integer fails validation.
- A provided `expected_exit_code` that differs from `exit_code` fails validation.

## Acceptance Tests

- PASS: `accept-turn` accepts a QA turn with `exit_code: 1` and `expected_exit_code: 1`.
- PASS: `accept-turn` accepts the tusq.dev BUG-102 shape where evidence summary explicitly says `--first-type STRING exits 1` and `--first-type boolean exits 1`.
- FAIL: `accept-turn` rejects `verification.status: "pass"` with undeclared non-zero machine evidence.

## Open Questions

- None for this patch. A future schema revision can formalize richer evidence kinds, but this fix keeps the current protocol backward-compatible.
