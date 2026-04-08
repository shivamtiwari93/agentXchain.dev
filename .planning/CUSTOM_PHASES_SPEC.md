# Custom Phases Spec

## Purpose

Allow operators to define arbitrary workflow phases beyond the hardcoded `planning`, `implementation`, `qa` set. The protocol must support any phase names declared in the `routing` config, making the phase system open-ended per VISION.md: "The framework must support arbitrary agent roles and arbitrary charters."

## Interface

### Config Layer (`agentxchain.json`)

```json
{
  "routing": {
    "planning": { "entry_role": "pm", "exit_gate": "planning_signoff" },
    "design": { "entry_role": "architect", "exit_gate": "design_review" },
    "implementation": { "entry_role": "dev", "exit_gate": "implementation_complete" },
    "security_review": { "entry_role": "security", "exit_gate": "security_signoff" },
    "qa": { "entry_role": "qa", "exit_gate": "qa_ship_verdict" }
  }
}
```

Phase order is derived from the declaration order of `routing` keys. This is already how `coordinator-gates.js` works but `normalized-config.js` and `coordinator-config.js` reject non-standard phases.

### Defaults

When no `routing` is configured, the default phase set remains `['planning', 'implementation', 'qa']`. This preserves backward compatibility and the scaffolded template experience.

### Semantic Gate Validation

Custom phases use `requires_files` and `requires_verification_pass` gate predicates. The existing semantic validators (PM_SIGNOFF, SYSTEM_SPEC, IMPLEMENTATION_NOTES, ACCEPTANCE_MATRIX, RELEASE_NOTES, SHIP_VERDICT) remain active for their specific file paths regardless of which phase references them. Custom phases get file-existence and verification-pass gates, not semantic content validation — that can be extended later.

## Behavior

1. `normalized-config.js` derives valid phases from `routing` keys when routing is present; falls back to `['planning', 'implementation', 'qa']` when absent.
2. `coordinator-config.js` derives valid phases from the coordinator's own routing config or from child repo configs; falls back to `['planning', 'implementation', 'qa']` when absent.
3. Phase order is routing declaration order (already the runtime behavior in `coordinator-gates.js`).
4. `phase_transition_request` must target the immediate next declared phase. Skipping a declared phase is protocol-invalid and must be rejected before acceptance.
5. Final phases cannot use `phase_transition_request`; they must use `run_completion_request`.
5. Phase colors in `status.js` use a fallback for unknown phases (e.g., `chalk.white`).

## Error Cases

| Scenario | Expected |
|----------|----------|
| Routing declares custom phase `security_review` | Config validation accepts it |
| Routing declares phase with invalid characters (spaces, uppercase) | Config validation rejects: `phase name must be lowercase alphanumeric with underscores/hyphens` |
| Turn in `planning` requests `implementation` while routing declares `planning -> design -> implementation` | Validation rejects: `next phase is "design"` |
| Turn in final phase requests another phase via `phase_transition_request` | Validation rejects: `use run_completion_request instead` |
| Coordinator workstream references phase not in any routing config | Config validation rejects: `workstream phase must appear in routing` |
| No routing configured | Default phases apply; existing behavior unchanged |

## Acceptance Tests

- AT-CP-001: Config with `routing: { planning, design, implementation, qa }` validates without error
- AT-CP-002: Config with `routing: { planning, implementation }` (no qa) validates without error
- AT-CP-003: Phase transition from `design` to `implementation` succeeds when routing declares both
- AT-CP-004: Phase transition that skips a custom phase is rejected
- AT-CP-008: Final-phase `phase_transition_request` is rejected and instructs the operator to use `run_completion_request`
- AT-CP-005: Coordinator workstream with custom phase validates against coordinator routing
- AT-CP-006: `status` command renders custom phase names with fallback color
- AT-CP-007: Existing 3-phase configs continue to work identically

## Open Questions

- Should custom phases support custom semantic validators (pluggable gate semantics)? Deferred — file-existence gates are sufficient for v1.
- Should templates scaffold custom phase artifacts? Deferred — operators define their own gate files for custom phases.
