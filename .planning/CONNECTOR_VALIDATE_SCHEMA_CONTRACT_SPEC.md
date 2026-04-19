## Connector Validate Schema Contract Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-18

## Purpose

`connector validate` already proves that one runtime+role binding can dispatch a synthetic governed turn and survive result validation.

That is not enough for non-reference runner portability work. The command also needs to prove that the validated binding is coherent with the published machine-readable contract surfaces:

- raw governed config schema: `agentxchain/schemas/agentxchain-config`
- connector capability handshake schema: `agentxchain/schemas/connector-capabilities-output`

This slice adds a schema-contract proof section to `connector validate --json` and fails closed if the selected runtime+role binding does not survive that continuity check.

## Interface

Existing command:

```bash
agentxchain connector validate <runtime_id> [--role <role_id>] [--json] [--timeout <ms>] [--keep-artifacts]
```

New JSON output field:

- `schema_contract`

## Behavior

- `connector validate` evaluates schema continuity before synthetic dispatch.
- The continuity proof is runtime+role scoped, not global.
- `schema_contract` always references the published artifact names:
  - `agentxchain/schemas/agentxchain-config`
  - `agentxchain/schemas/connector-capabilities-output`
- The proof checks:
  - the selected `runtime_id` exists in raw config
  - the selected `role_id` exists in raw config
  - the raw role binding (`roles.<role>.runtime`) matches the selected runtime
  - the generated capability report uses the same `runtime_id`
  - the generated capability report contains a role binding entry for the selected role
- If any of those checks fail, `connector validate` fails closed before dispatch and includes the failure list in `schema_contract.failures`.
- On success, `schema_contract.ok` is `true` and every continuity boolean is `true`.

## Error Cases

- selected runtime missing from raw config
- selected role missing from raw config
- raw role runtime binding does not match the selected runtime
- generated capability report uses a different runtime id
- generated capability report omits the selected role binding

## Acceptance Tests

- `AT-CSC-001`: a valid runtime+role binding produces `schema_contract.ok: true` with the published artifact names.
- `AT-CSC-002`: a raw role/runtime mismatch fails closed with `schema_contract.ok: false` and a named failure.
- `AT-CSC-003`: a missing role binding in the generated capability report fails closed with `schema_contract.ok: false`.
- `AT-CCV-004`: `connector validate --json` includes a passing `schema_contract` alongside dispatch and validator success for a valid runtime.
- `AT-CCV-005`: failed validations still include `schema_contract` so portability debugging does not disappear on dispatch or validator failures.

## Open Questions

- Whether a future slice should publish a standalone JSON Schema for `connector validate --json` output too.
