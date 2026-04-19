# Workflow Kit Output Schema Spec

**Status:** Shipped (Turn 219)
**Decision:** `DEC-WORKFLOW-KIT-OUTPUT-SCHEMA-001`

## Purpose

Provide a machine-readable JSON Schema for the `workflow-kit describe --json` output. This mirrors the pattern established by `connector-capabilities-output.schema.json` — third-party tooling can validate the workflow kit contract output without reverse-engineering CLI behavior.

## Interface

- Package export: `agentxchain/schemas/workflow-kit-output`
- Schema file: `cli/src/lib/schemas/workflow-kit-output.schema.json`
- Schema ID: `https://agentxchain.dev/schemas/workflow-kit-output.schema.json`

## Output Shapes

### Success response

```json
{
  "workflow_kit_version": "1.0",
  "source": "default",
  "phase_templates": {
    "available": ["planning-default", ...],
    "in_use": ["planning-default", ...]
  },
  "phases": {
    "<phase_id>": {
      "template": "planning-default",
      "source": "default",
      "artifacts": [
        { "path": ".planning/PM_SIGNOFF.md", "required": true, "semantics": "pm_signoff", "exists": false }
      ]
    }
  },
  "semantic_validators": ["pm_signoff", ...],
  "gate_artifact_coverage": {
    "<gate_id>": {
      "linked_phases": ["planning"],
      "predicates_referencing_artifacts": 3,
      "artifacts_covered": [".planning/PM_SIGNOFF.md", ...]
    }
  }
}
```

### Error response

CLI exits non-zero with text output. No structured JSON error response defined for this command (it uses `process.exit(1)` with console text).

## Acceptance Tests

- AT-WKO-001: default governed project JSON output validates against the schema
- AT-WKO-002: explicit workflow_kit config JSON output validates against the schema
- AT-WKO-003: schema is importable via package export `agentxchain/schemas/workflow-kit-output`
- AT-WKO-004: schema `$id` and `title` are correct
- AT-WKO-005: real CLI command output round-trips through schema validation (config schema → workflow-kit describe → output schema)

## Open Questions

None.
