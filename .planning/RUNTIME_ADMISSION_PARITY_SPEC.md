# Runtime Admission Parity Spec

## Purpose

Keep runtime capability truth consistent across inspection, validation, and admission control.

The repo now exposes runtime capability contracts through `role show`, `doctor`, and dispatch context. That work is incomplete if `validate`, `doctor` admission checks, and the run loop still use separate hand-rolled runtime reasoning. This slice collapses those reachability decisions onto the shared runtime contract so the repo has one answer for:

- invalid runtime/write-authority bindings
- whether a routed role can satisfy required file production
- whether an `owned_by` role can satisfy workflow-kit ownership

## Interface

Extend `cli/src/lib/runtime-capabilities.js` with reusable helpers:

- `canRoleParticipateInRequiredFileProduction(role, runtime)`
- `canRoleSatisfyWorkflowArtifactOwnership(role, runtime)`

These helpers derive from the existing role-bound runtime capability contract instead of re-implementing runtime branching elsewhere.

Required consumers:

1. `cli/src/lib/admission-control.js`
2. `cli/src/lib/normalized-config.js`

## Behavior

- `manual` review-only bindings remain valid for workflow-kit ownership and required-file production.
- `local_cli` review-only remains invalid.
- `api_proxy` and `remote_agent` authoritative bindings remain invalid.
- `api_proxy` and `remote_agent` proposed bindings remain reachable through `proposal_apply_required`; they are not a static dead-end.
- `mcp` remains `tool_defined` and must not be rejected by admission control purely because the role is `review_only`.
- Admission errors must describe the effective reachability path instead of assuming every failure is “all roles are review_only.”

## Error Cases

- Unknown runtime types remain handled by existing config validation; capability helpers should fail closed for `unknown`.
- Missing runtime references remain config-validation errors; downstream helpers should treat them as non-reachable rather than crashing.
- `tool_defined` must not be converted into a false hard error.

## Acceptance Tests

1. `runAdmissionControl()` does not emit `ADM-001` for a gated phase backed only by `mcp` `review_only` roles.
2. `validateV4Config()` still rejects `review_only + local_cli` and `authoritative + remote_agent/api_proxy` through the shared runtime contract.
3. `agentxchain validate --json` does not surface `ADM-001` for the `mcp review_only` case.
4. `agentxchain doctor --json` does not report `admission_control: fail` for the same `mcp review_only` case.

## Open Questions

None. The contract already exists; this work only removes drift.
