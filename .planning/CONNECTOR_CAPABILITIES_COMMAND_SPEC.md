# Connector Capabilities Command Spec

**Status:** Shipped (Turn 209)
**Decision:** DEC-CONNECTOR-CAPABILITIES-COMMAND-001

## Purpose

Expose the merged runtime capability contract as a machine-readable JSON surface for third-party tooling. External runners, IDE extensions, and non-reference implementations must be able to inspect the effective capability contract for any configured runtime without reverse-engineering `doctor`, `role show`, or `status` output.

## Interface

```
agentxchain connector capabilities <runtime_id> [--json] [--all]
```

### Arguments

- `<runtime_id>` — the runtime to inspect (from `agentxchain.json` runtimes). Optional if `--all` is specified.
- `--all` — emit capability contracts for every configured runtime.
- `--json` — structured JSON output (default: human-readable text).

### Output Shape (JSON)

Single runtime:
```json
{
  "runtime_id": "dev_cli",
  "runtime_type": "local_cli",
  "declared_capabilities": { "can_write_files": "direct" },
  "merged_contract": {
    "runtime_type": "local_cli",
    "transport": "local_cli",
    "can_write_files": "direct",
    "proposal_support": "optional",
    "requires_local_binary": true,
    "workflow_artifact_ownership": "yes"
  },
  "declaration_warnings": [],
  "role_bindings": [
    {
      "role_id": "dev",
      "role_write_authority": "authoritative",
      "effective_write_path": "direct",
      "workflow_artifact_ownership": "yes",
      "notes": []
    }
  ]
}
```

`--all`:
```json
{
  "runtimes": [ ...per-runtime objects as above... ]
}
```

### Behavior

1. Load project context (`agentxchain.json`).
2. Resolve the named runtime (or all runtimes if `--all`).
3. For each runtime:
   a. Compute type-based defaults via `getRuntimeCapabilityContract()`.
   b. Extract declared capabilities from `runtime.capabilities` (raw operator input).
   c. Compute the merged contract (type defaults + explicit declarations).
   d. Compute declaration warnings via `getCapabilityDeclarationWarnings()`.
   e. For each role bound to this runtime, compute the role-level contract via `getRoleRuntimeCapabilityContract()`.
4. Emit the result.

### Error Cases

- No `agentxchain.json` found: exit 2 with error.
- Unknown `runtime_id`: exit 2 with error naming the runtime and listing available runtimes.
- `--all` with no runtimes configured: emit empty `runtimes: []`.

## Acceptance Tests

- AT-CC-001: `connector capabilities <runtime_id> --json` returns the merged contract with correct type defaults for `local_cli`.
- AT-CC-002: `connector capabilities <runtime_id> --json` returns declared overrides merged over type defaults for MCP with `capabilities.can_write_files: "direct"`.
- AT-CC-003: `connector capabilities --all --json` returns all configured runtimes.
- AT-CC-004: `connector capabilities <unknown_id> --json` returns an error with available runtime IDs.
- AT-CC-005: Role bindings appear with correct effective write paths.
- AT-CC-006: Declaration warnings surface for known-incompatible combinations.

## Open Questions

None.
