# Connector Capability Declaration — Spec

> Status: Shipped (Turn 207)

---

## Purpose

Allow connectors to **self-declare their capabilities** in `agentxchain.json` instead of relying solely on type-based inference. This makes the protocol portable: a non-reference runner reading the config can determine a connector's capability contract without hardcoding type logic.

This addresses VISION.md requirements:
- "Connectors should remain replaceable"
- "The protocol should survive changes in models, tools, and vendors"

---

## Interface

### Config Schema Extension

Each runtime in `agentxchain.json` may include an optional `capabilities` object:

```json
{
  "runtimes": {
    "my-mcp-writer": {
      "type": "mcp",
      "command": ["my-tool"],
      "capabilities": {
        "can_write_files": "direct",
        "proposal_support": "optional",
        "workflow_artifact_ownership": "yes"
      }
    }
  }
}
```

### Allowed capability fields

| Field | Values | Meaning |
|-------|--------|---------|
| `can_write_files` | `direct`, `proposal_only`, `tool_defined`, `unknown` | What file-write path the connector uses |
| `proposal_support` | `native`, `optional`, `none`, `tool_defined` | Whether the connector supports proposal-based staging |
| `workflow_artifact_ownership` | `yes`, `no`, `proposal_apply_required`, `tool_defined`, `unknown` | Whether the connector can satisfy workflow-kit file requirements |

### Fields NOT declarable

- `runtime_type` — derived from `type`, not overridable
- `transport` — derived from `type` + `transport` field, not overridable
- `requires_local_binary` — derived from transport, not overridable
- `review_only_behavior` — prose, not a dispatch-time contract

---

## Behavior

### Resolution Order

1. Compute the type-based default contract via `getRuntimeCapabilityContract(runtime)`
2. If `runtime.capabilities` exists and is a non-empty object, merge each allowed field over the type-based default
3. Fields not in the allowed set are silently ignored (forward-compatible with future fields)
4. Fields not declared explicitly retain their type-based default

### Validation Constraints

Not all combinations are valid. The following constraints apply after merge:

1. **Authoritative + remote transport**: if `can_write_files === 'direct'` and the runtime type is `api_proxy` or `remote_agent`, `conformance check` emits a warning (the reference runner does not support this path in v1, but a third-party runner may)
2. **Unknown type**: if `type` is not one of the 5 known types, declared capabilities are used directly with no type-based defaults (fully self-declared connector)
3. **MCP override**: MCP connectors default to `tool_defined` for write/proposal/ownership. Explicit declarations override these defaults, enabling MCP connectors that are known to write files directly

### Conformance Surface

`conformance check` (and `connector validate`) report:
- Whether the runtime has explicit capability declarations
- Whether declared capabilities differ from type-inferred defaults
- Whether any declared capability violates known type constraints

---

## Error Cases

1. `capabilities` is present but not an object → ignored with warning
2. `capabilities` contains only unknown fields → treated as empty (type defaults apply)
3. `capabilities` declares `can_write_files: "direct"` on `api_proxy` type → conformance warning (not error), dispatch proceeds with declared capability

---

## Acceptance Tests

1. Runtime with no `capabilities` field → type-based contract unchanged (backward compatible)
2. MCP runtime with `capabilities: { can_write_files: "direct" }` → contract shows `direct` instead of `tool_defined`
3. Unknown runtime type with declared capabilities → uses declared values, `unknown` for undeclared fields
4. `api_proxy` with `capabilities: { can_write_files: "direct" }` → contract shows `direct`, conformance emits warning
5. `capabilities` with unknown fields → silently ignored, type defaults preserved

---

## Open Questions

None for this slice.
