## Connector Validate Command Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-17

## Purpose

Close the onboarding gap between:

- `agentxchain connector check`, which proves runtime reachability only
- a real automated governed turn, which requires the runtime to emit a protocol-valid `turn-result.json`

`connector validate` is the first-run proof surface for automation. It dispatches one synthetic governed turn through a configured runtime, validates the staged turn result with the existing acceptance validator, and reports whether the runtime can satisfy the contract before the operator commits to a real run.

This command is intentionally separate from `connector check`.

- `check` answers: "Can I reach the runtime?"
- `validate` answers: "Can this runtime+role binding actually produce a valid governed turn result?"

## Interface

```bash
agentxchain connector validate <runtime_id> [--role <role_id>] [--json] [--timeout <ms>] [--keep-artifacts]
```

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `<runtime_id>` | required | Validate one configured non-manual runtime |
| `--role <role_id>` | first configured role bound to the runtime | Validate a specific runtime+role binding |
| `--json` | `false` | Emit structured JSON |
| `--timeout <ms>` | `120000` | Upper bound for the synthetic dispatch |
| `--keep-artifacts` | `false` | Keep the scratch validation workspace even on success |

## Behavior

### Scope boundary

- Governed repos only.
- One runtime at a time. This command must not silently validate every configured runtime because some validations incur real model/API spend.
- Non-manual runtimes only: `local_cli`, `api_proxy`, `mcp`, `remote_agent`.
- Validation is **role-scoped**, not universal. A pass proves the selected runtime+role binding, not every other role that happens to share the same runtime.

### Scratch workspace

- Validation must run in a scratch copy of the current repo, never directly in the operator's live workspace.
- The scratch workspace must preserve relative command/cwd assumptions for `local_cli` and MCP stdio runtimes.
- Git history does not need to be preserved, but the scratch repo should be initialized as a lightweight git checkout so local agent commands that assume a git repo do not fail for avoidable reasons.
- On failure, the scratch workspace is kept automatically and surfaced in output for debugging.
- On success, the workspace is deleted unless `--keep-artifacts` is set.

### Role selection

- `--role <role_id>` must fail closed if the role is not configured or is not bound to `<runtime_id>`.
- Without `--role`, the command picks the first configured role bound to the runtime and emits a warning when multiple roles share that runtime.

### Synthetic turn contract

- The command must create one synthetic governed run and assign one turn to the selected role.
- The dispatch bundle prompt must explicitly say this is a connector-validation turn, not real delivery work.
- The prompt must instruct the runtime to:
  - avoid editing product files
  - emit a valid staged turn result to the provided staging path
  - use `files_changed: []`
  - use `artifact.type: "review"`
  - set `proposed_next_role: "human"`
  - avoid lifecycle requests (`phase_transition_request`, `run_completion_request`)
- For `review_only` roles, the prompt must explicitly require at least one objection so the validation satisfies the challenge contract.

### Validation path

- Dispatch must use the shipped adapter for the runtime type.
- After dispatch, the command must run `validateStagedTurnResult()` against the staged artifact.
- A command pass requires:
  - adapter dispatch success
  - staged turn result present
  - validator result `ok: true`
- A command failure includes:
  - adapter dispatch errors
  - missing staged result
  - validator stage / error class / error messages

### Output contract

Structured output includes:

- `overall`
- `runtime_id`
- `role_id`
- `runtime_type`
- `timeout_ms`
- `warnings`
- `schema_contract`
- `dispatch`
- `validation`
- `scratch_root` when artifacts are kept
- `cost_usd` when the staged result includes cost metadata

Text output must state:

- runtime ID and type
- selected role
- pass/fail
- validator stage when failed
- scratch workspace path when retained

## Error Cases

- no governed project root
- legacy v3 project
- unknown runtime
- manual runtime requested
- role/runtime mismatch
- no roles are bound to the runtime
- scratch workspace creation failure
- adapter dispatch failure
- staged turn result missing
- validator rejection
- schema-contract continuity failure between the selected runtime+role binding and the published config / handshake artifacts

## Acceptance Tests

- `AT-CCV-001`: `connector validate --json` fails closed outside a governed project.
- `AT-CCV-002`: unknown runtime IDs fail closed.
- `AT-CCV-003`: manual runtimes are rejected with a clear boundary error.
- `AT-CCV-004`: a `local_cli` runtime backed by a deterministic validation agent passes and returns validator success.
- `AT-CCV-005`: an invalid staged result fails with validator stage + error details and preserves the scratch workspace path.
- `AT-CCV-006`: `api_proxy` validation fails closed when required auth env is missing.
- `AT-CCV-007`: docs distinguish `connector check` reachability from `connector validate` contract proof.
- `AT-CCV-008`: CLI command map includes `connector validate`.
- `AT-CCV-009`: integration guides that recommend `connector check` before `agentxchain run` also show `connector validate <runtime_id>` between `connector check` and `run`.

## Open Questions

- Whether a future slice should add `connector validate --all` once spend controls and batching semantics are explicit.
- Whether successful validations should optionally emit a reusable proof artifact under `.agentxchain/validation/`.
