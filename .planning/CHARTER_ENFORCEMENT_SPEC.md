# Charter Enforcement Spec

## Purpose

Turn role mandates from descriptive prompt metadata into enforceable artifact-ownership contracts. When a workflow-kit artifact declares an owning role, the gate evaluator must verify that the owning role actively participated in the current phase before the artifact can satisfy the gate.

## Status

Slice 1: artifact `owned_by` config validation + gate enforcement.

## Background

Today, role `mandate` is injected into prompts but never enforced at runtime. Any role can satisfy any artifact gate. For example, a `dev` role could produce `SECURITY_REVIEW.md` and the gate would pass — even though the `security_reviewer` role owns that artifact per the template.

Charter enforcement connects roles to artifacts at the gate level, creating verifiable proof that the right role did the right work.

## Interface

### Config Schema

Workflow-kit artifact entries gain an optional `owned_by` field:

```json
{
  "workflow_kit": {
    "phases": {
      "security_review": {
        "artifacts": [
          {
            "path": ".planning/SECURITY_REVIEW.md",
            "required": true,
            "semantics": "section_check",
            "semantics_config": { "required_sections": ["Threat Model", "Findings", "Verdict"] },
            "owned_by": "security_reviewer"
          }
        ]
      }
    }
  }
}
```

### Validation Rules

1. `owned_by` must be a string matching `VALID_ROLE_ID_PATTERN` (`/^[a-z0-9_-]+$/`)
2. `owned_by` must reference a role ID that exists in `config.roles`
3. `owned_by` is optional — omitting it preserves current behavior (any role can satisfy the artifact)

### Gate Enforcement

When `evaluateGateArtifacts` processes an artifact with `owned_by`:

1. Check file existence (existing behavior)
2. Check semantic validity (existing behavior)
3. **New**: Check that at least one accepted turn in the current phase was assigned to the `owned_by` role

The ownership check uses `state.history` (the array of accepted turn records). A turn counts as "ownership participation" when:
- `turn.phase === currentPhase`
- `turn.role === artifact.owned_by`

Important runtime truth: accepted turns are represented by their presence in `state.history`. The original turn-result `status` remains operator/runtime truth such as `completed`; the ownership check must not invent a separate `accepted` status value that the runtime does not emit.

### Failure Mode

If the artifact exists and passes semantic checks but no accepted turn from the owning role exists in the current phase:

```
Gate failure: ".planning/SECURITY_REVIEW.md" requires participation from role "security_reviewer" in phase "security_review", but no accepted turn from that role was found
```

The gate returns `gate_failed` — the turn is accepted but the phase transition is blocked.

## Behavior

### Happy Path

1. Operator declares `owned_by: "security_reviewer"` on `SECURITY_REVIEW.md` in the `security_review` phase
2. `security_reviewer` role takes a turn in the `security_review` phase, producing the artifact
3. Phase transition is requested → gate checks file existence, semantics, AND ownership → passes

### Blocked Path

1. `dev` role takes a turn in the `security_review` phase and produces the artifact
2. Phase transition is requested → gate checks file existence ✓, semantics ✓, ownership ✗ → `gate_failed`
3. Operator must assign a turn to `security_reviewer` before the phase can advance

### No Ownership Declared

1. Artifact has no `owned_by` field → current behavior unchanged
2. Any role can satisfy the artifact gate

### Multiple Artifacts with Different Owners

1. Phase has `ARCHITECTURE.md` owned by `architect` and `SECURITY_REVIEW.md` owned by `security_reviewer`
2. Both roles must participate in the phase for the gate to pass
3. Each artifact's ownership is checked independently

## Error Cases

| Scenario | Result |
|----------|--------|
| `owned_by` references nonexistent role | Config validation error |
| `owned_by` is not a valid role ID format | Config validation error |
| Artifact exists but owning role never took a turn in phase | Gate failure |
| Artifact missing (regardless of `owned_by`) | Gate failure (existing behavior) |
| `owned_by` on optional (`required: false`) artifact | Ownership checked only if file exists |

## Acceptance Tests

### Config Validation

- `AT-CHARTER-001`: Valid `owned_by` referencing existing role → validation passes
- `AT-CHARTER-002`: `owned_by` referencing nonexistent role → validation error with message naming the role and artifact
- `AT-CHARTER-003`: `owned_by` with invalid format (uppercase, spaces) → validation error
- `AT-CHARTER-004`: No `owned_by` → validation passes (backward compatible)
- `AT-CHARTER-005`: Multiple artifacts with different `owned_by` → all validated against `config.roles`

### Gate Enforcement

- `AT-CHARTER-010`: Artifact with `owned_by` + accepted turn from that role in phase → gate passes
- `AT-CHARTER-011`: Artifact with `owned_by` + NO accepted turn from that role → gate fails with ownership reason
- `AT-CHARTER-012`: Artifact with `owned_by` + accepted turn from WRONG role → gate fails
- `AT-CHARTER-013`: Artifact without `owned_by` → gate passes regardless of which role took turns (existing behavior)
- `AT-CHARTER-014`: Optional artifact (`required: false`) with `owned_by` + file missing → gate passes (file not required)
- `AT-CHARTER-015`: Optional artifact with `owned_by` + file exists + no owning role turn → gate fails (file exists so ownership matters)
- `AT-CHARTER-016`: Multiple artifacts, one owned, one not → owned one checked, unowned one not
- `AT-CHARTER-017`: Run-completion gate respects `owned_by` the same way as phase-exit gate
- `AT-CHARTER-E2E-001`: A repo created by `init --governed --template enterprise-app` must rely on scaffolded `ROADMAP.md` and `SYSTEM_SPEC.md` during planning, then block a `dev`-only architecture handoff until an `architect` turn is accepted. The test must not overwrite those scaffolded files before proving runtime behavior.

## Open Questions

1. **Should `owned_by` accept an array of roles?** For v1, single role only. If operators need shared ownership, they can use separate artifacts per role.
2. **Should ownership check cross phases?** No. Ownership participation is phase-scoped. A turn from `security_reviewer` in `planning` does not satisfy ownership in `security_review`.
3. **Should we verify the specific turn modified the file?** Not in v1. Verifying role participation in the phase is sufficient. File-level attribution would require git blame integration, which is out of scope.
