# Workflow Kit Contract Spec

**Status:** Shipped
**Decision:** DEC-WORKFLOW-KIT-CONTRACT-001

## Purpose

Formalize the workflow kit as a separable, introspectable protocol layer (VISION.md layer 4) with a machine-readable contract surface. The workflow kit is AgentXchain's opinionated operating model for real software delivery — it sits above the constitutional protocol layer and below integrations.

## Boundary

**Protocol layer (constitutional):** run state, role definitions, turn contracts, artifact contracts, validation rules, decision ledger, gates, recovery rules. Defined by protocol v7. Runner-agnostic.

**Workflow kit layer (operating model):** planning framework, spec-driven development, repo-native documentation, test-driven quality. Includes:

- Phase templates (planning-default, implementation-default, qa-default, architecture-review, security-review)
- Workflow artifacts (PM_SIGNOFF.md, SYSTEM_SPEC.md, IMPLEMENTATION_NOTES.md, acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md, ARCHITECTURE.md, SECURITY_REVIEW.md)
- Semantic validators (pm_signoff, system_spec, implementation_notes, acceptance_matrix, ship_verdict, release_notes, section_check)
- Gate predicates that consume workflow artifacts
- Phase routing that references workflow templates

The workflow kit is NOT protocol conformance. A non-reference runner can implement protocol v7 without using the workflow kit. The workflow kit is the reference runner's opinion on how governed delivery should happen.

## Interface

### CLI command: `agentxchain workflow-kit describe [--json]`

Returns the workflow kit contract for the current project.

**Output shape (JSON):**
```json
{
  "workflow_kit_version": "1.0",
  "source": "default | explicit | mixed",
  "phase_templates": {
    "available": [...],
    "in_use": [...]
  },
  "phases": {
    "<phase_id>": {
      "template": "<template_id> | null",
      "source": "default | explicit | not_declared",
      "artifacts": [
        {
          "path": "...",
          "required": true,
          "semantics": "pm_signoff | null",
          "exists": true
        }
      ]
    }
  },
  "semantic_validators": ["pm_signoff", "system_spec", ...],
  "gate_artifact_coverage": {
    "<gate_id>": {
      "predicates_referencing_artifacts": 0,
      "artifacts_covered": []
    }
  }
}
```

### Text output (default)

Human-readable summary showing:
- Workflow kit version and source
- Phase-by-phase artifact listing with existence status
- Active semantic validators
- Gate coverage summary

## Error Cases

| Condition | Behavior |
|-----------|----------|
| Not a governed project | Error: "Not a governed AgentXchain project" |
| No workflow_kit config | Show default-derived contract |
| No phases configured | Error: "No governed phases are defined" |

## Acceptance Tests

- AT-WK-001: Default governed project returns workflow_kit_version, all 3 default templates in_use, 7 artifacts across phases
- AT-WK-002: Explicit workflow_kit config reflects user overrides in source and template fields
- AT-WK-003: `--json` output validates as structured JSON with all required fields
- AT-WK-004: Semantic validators list matches the exported set from workflow-gate-semantics.js
- AT-WK-005: Gate artifact coverage correctly maps gate predicates to workflow artifacts
- AT-WK-006: Non-governed project returns error

## Open Questions

None.
