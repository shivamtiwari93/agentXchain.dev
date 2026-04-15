# Admission Control — Pre-Run Rejection for Dead-End Configs

## Purpose

Reject governed configs that **cannot possibly reach completion** before wasting runtime tokens, wall-clock time, and human attention. These are static analyses of config topology — no run state required.

## Scope

Admission control detects three classes of dead-end configs:

### ADM-001: No file producer for gated phase

A phase's exit gate requires file artifacts (via `requires_files` or `workflow_kit.phases[phase].artifacts` with `required: true`), but every role routed to that phase has `write_authority: review_only`.

**Existing partial coverage:** `collectRemoteReviewOnlyGateWarnings` in `normalized-config.js` catches the narrow case where all roles are *both* `review_only` *and* remote runtimes. ADM-001 generalizes this: the issue is `review_only` authority regardless of runtime type. A `local_cli` role with `review_only` also cannot produce files.

### ADM-002: Authoritative writer unreachable for owned artifacts

A `workflow_kit` artifact declares `owned_by: <role>`, and the gate checks ownership (the role must have an accepted turn in that phase). But that role is not in the phase's routing (`entry_role` or `allowed_next_roles`). The artifact can never be satisfied because the owner can never participate.

### ADM-003: Impossible human approval topology

A phase transition or run completion requires human approval (`requires_human_approval: true` in gate, or `approval_policy` rule with `action: require_human`), but the run has no path to human review:
- No role in the project uses `runtime.type: manual`
- AND the `approval_policy` has no `auto_approve` override for that transition

This means the run will always pause at a `pending_phase_transition` or `pending_run_completion` that no automated agent can resolve, and no manual runtime exists to surface the approval.

**Important nuance:** This is a *warning*, not a hard error. Many projects intentionally require human approval via external tooling (CLI `approve-transition`, dashboard, CI webhook). ADM-003 flags configs where no *in-config* manual path exists, as a "did you mean to do this?" check.

## Interface

```javascript
// src/lib/admission-control.js
export function runAdmissionControl(config, rawConfig) → AdmissionResult

// AdmissionResult:
{
  ok: boolean,           // true if no errors (warnings are ok)
  errors: string[],      // ADM-001, ADM-002 — hard rejections
  warnings: string[],    // ADM-003 — soft advisories
}
```

## Behavior

1. `runAdmissionControl` is a **pure function** — no filesystem access, no state reads.
2. It operates on the normalized config + raw config (for `workflow_kit`, `gates`, `approval_policy`).
3. It returns errors for ADM-001 and ADM-002 (these are provably dead-end).
4. It returns warnings for ADM-003 (legitimate use cases exist).
5. The function uses `getEffectiveGateArtifacts` from `gate-evaluator.js` to merge gate `requires_files` with `workflow_kit` artifacts, ensuring consistent artifact resolution.

## Integration Points

1. **`validate` command** — `validateGovernedProject` calls `runAdmissionControl` and merges errors/warnings into its result. Replaces the narrower `collectRemoteReviewOnlyGateWarnings` call.
2. **`doctor` command** — `governedDoctor` adds an `admission_control` check using `runAdmissionControl`.
3. **`run` pre-flight** — `runLoop` calls `runAdmissionControl` before the first turn and refuses to start if `ok === false`.

## Error Cases

- Config with no routing → skip all checks (nothing to evaluate)
- Config with no gates → skip ADM-001/ADM-002 (no gated phases)
- Role references non-existent runtime → skip that role (already caught by config validation)
- Empty `requires_files` + no workflow_kit artifacts → phase passes trivially, skip

## Acceptance Tests

- AT-ADM-001: Config with all `review_only` roles in a gated phase → error
- AT-ADM-002: Config with `owned_by` role not in phase routing → error
- AT-ADM-003: Config with `requires_human_approval` but no manual runtime → warning
- AT-ADM-004: Config with mixed authorities (at least one `authoritative`) → passes
- AT-ADM-005: Config with manual runtime present → no ADM-003 warning
- AT-ADM-006: Config with auto_approve policy override → no ADM-003 warning
- AT-ADM-007: Config with no gates → clean pass
- AT-ADM-008: Config with workflow_kit artifacts (not just requires_files) → ADM-001 catches
- AT-ADM-009: runLoop refuses to start when admission control fails

## Open Questions

None. Ship it.
