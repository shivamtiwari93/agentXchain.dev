# Runtime Capability Surface Spec

## Purpose

Make configured runtimes inspectable as first-class operator truth.

Today the repo already knows important runtime boundaries:

- `api_proxy` and `remote_agent` do not provide direct local workspace writes
- `local_cli` requires a local binary and should not be bound to `review_only`
- `manual` can satisfy workflow-kit file ownership even for review roles
- `mcp` transport support exists, but repo-write proof is tool-dependent rather than guaranteed by runtime type alone

Those rules are scattered across config validation, dispatch prompt prose, and adapter comments. Operators should not have to reverse-engineer them from source.

## Interface

Add a shared runtime-capability contract in `cli/src/lib/runtime-capabilities.js`.

Base runtime contract fields:

- `runtime_type`
- `transport`
- `can_write_files`
- `review_only_behavior`
- `proposal_support`
- `requires_local_binary`
- `workflow_artifact_ownership`

Role-bound effective contract fields:

- `role_id`
- `role_write_authority`
- `effective_write_path`
- `workflow_artifact_ownership`
- `notes[]`

Required operator surfaces:

1. `agentxchain role show <role_id>`
2. `agentxchain doctor [--json]`
3. dispatch context (`CONTEXT.md`) for assigned turns

## Behavior

The contract must be explicit instead of flattening runtime behavior into fake booleans.

Canonical base enums:

- `can_write_files`: `direct` | `proposal_only` | `tool_defined` | `none` | `unknown`
- `proposal_support`: `none` | `native` | `optional` | `tool_defined` | `unknown`
- `workflow_artifact_ownership`: `yes` | `proposal_apply_required` | `tool_defined` | `no` | `unknown`

Runtime mapping:

### `manual`

- `transport: "manual"`
- `can_write_files: "direct"`
- `proposal_support: "none"`
- `requires_local_binary: false`
- `workflow_artifact_ownership: "yes"`

### `local_cli`

- `transport: "local_cli"`
- `can_write_files: "direct"`
- `proposal_support: "optional"`
- `requires_local_binary: true`
- `workflow_artifact_ownership: "yes"`

### `api_proxy`

- `transport: "provider_api"`
- `can_write_files: "proposal_only"`
- `proposal_support: "native"`
- `requires_local_binary: false`
- `workflow_artifact_ownership: "proposal_apply_required"`

### `remote_agent`

- `transport: "remote_http"`
- `can_write_files: "proposal_only"`
- `proposal_support: "native"`
- `requires_local_binary: false`
- `workflow_artifact_ownership: "proposal_apply_required"`

### `mcp`

- `transport: "mcp_stdio"` when `transport` is absent or `stdio`
- `transport: "mcp_streamable_http"` when `transport` is `streamable_http`
- `can_write_files: "tool_defined"`
- `proposal_support: "tool_defined"`
- `requires_local_binary: true` for stdio, `false` for streamable HTTP
- `workflow_artifact_ownership: "tool_defined"`

Role-bound rules:

- `review_only` on `manual` remains valid for workflow-kit ownership because the operator can write `.planning/*` artifacts manually
- `review_only` on `api_proxy` or `remote_agent` yields `workflow_artifact_ownership: "no"`
- `proposed` on `api_proxy` or `remote_agent` yields `workflow_artifact_ownership: "proposal_apply_required"`
- `authoritative` on `api_proxy` or `remote_agent` is an invalid binding and must surface as such if encountered
- `mcp` remains `tool_defined` unless a stronger repo-wide proof is added later

## Error Cases

- Unknown runtime type: surface `unknown` contract values instead of inventing behavior
- Missing runtime on a role: `role show` exits non-zero as it does today
- Invalid authority/runtime binding discovered through already-invalid config: surface the invalid effective contract instead of hiding it
- `doctor` must not crash when a runtime exists with zero bound roles

## Acceptance Tests

1. `role show --json` includes the base runtime contract plus role-bound effective contract.
2. `doctor --json` includes per-runtime runtime contract fields and role-bound summaries for at least `manual`, `local_cli`, `api_proxy`, `remote_agent`, and `mcp`.
3. `CONTEXT.md` includes a dedicated runtime capability section for the assigned turn.
4. Docs describe that `role show` and `doctor` expose transport, write-path, proposal, binary, and workflow-artifact ownership truth.

## Open Questions

- `mcp` repo-write behavior remains deliberately `tool_defined`. Do not strengthen this without proof that covers arbitrary MCP tool contracts rather than only shipped examples.
