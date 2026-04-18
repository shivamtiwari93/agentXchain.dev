# Role Runtime Capability Consumption — Spec

> Status: Proposed for Turn 208, implemented in the same turn

---

## Purpose

Ensure `getRoleRuntimeCapabilityContract()` derives its role-level truth from the merged runtime capability contract, not only from raw `runtime.type`.

Without this, explicit connector capability declarations are only half-real: `getRuntimeCapabilityContract()` reflects them, but `role show`, `doctor`, admission control, and dispatch context can still report stale type defaults.

---

## Interface

- `getRoleRuntimeCapabilityContract(roleId, role, runtime)`

Inputs:
- `role.write_authority`
- `runtime.type`
- merged runtime capability contract from `getRuntimeCapabilityContract(runtime)`

Outputs:
- `effective_write_path`
- `workflow_artifact_ownership`
- `notes`
- `runtime_contract`

---

## Behavior

1. `getRoleRuntimeCapabilityContract()` must call `getRuntimeCapabilityContract(runtime)` first and use the merged result as its source of truth.
2. For `authoritative` roles:
   - `can_write_files: "direct"` resolves to `effective_write_path: "direct"` even for `mcp` or unknown runtime types.
   - `can_write_files: "proposal_only"` resolves to `invalid_authoritative_binding`.
   - `can_write_files: "tool_defined"` resolves to `tool_defined`.
3. For `proposed` roles:
   - `can_write_files: "direct"` resolves to `patch_authoring`.
   - `can_write_files: "proposal_only"` resolves to `proposal_apply_required`.
   - `can_write_files: "tool_defined"` resolves to `tool_defined`.
4. `review_only` remains authority-constrained:
   - `manual` remains `planning_only` with workflow ownership `yes`
   - `local_cli` remains invalid only when the merged write path is still `direct`
   - `tool_defined` remains `tool_defined`
5. `runtime_contract` and the role-level fields must agree. A declared direct-writing MCP runtime must not surface `runtime_contract.can_write_files = "direct"` while still claiming `effective_write_path = "tool_defined"`.

---

## Error Cases

1. Connector declares `can_write_files: "direct"` but leaves ownership undeclared:
   - effective write path still becomes `direct` for `authoritative`
   - workflow ownership follows the merged runtime contract and may remain `tool_defined`
2. Connector declares an impossible combination for the reference runner (for example `api_proxy` + `direct`):
   - role-level contract reflects the declaration
   - conformance warnings remain the mechanism for flagging the mismatch
3. Unknown `can_write_files` values are ignored upstream by runtime capability merging; role-level resolution falls back to `unknown`

---

## Acceptance Tests

1. MCP runtime with `capabilities.can_write_files = "direct"` and authoritative role resolves to `effective_write_path = "direct"`
2. The same runtime with proposed role resolves to `effective_write_path = "patch_authoring"`
3. `role show --json` surfaces the corrected effective path for a declared direct-writing MCP runtime
4. `doctor --json` surfaces the corrected bound-role effective path for a declared direct-writing MCP runtime

---

## Open Questions

None for this slice.
