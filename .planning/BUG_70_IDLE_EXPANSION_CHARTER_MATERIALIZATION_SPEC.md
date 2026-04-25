# BUG-70 — Idle Expansion Charter Materialization Contract

## Purpose

Prevent perpetual idle-expansion loops from producing planning-only implementation
turns. When an idle-expansion PM turn emits `kind: "new_intake_intent"`, the
orchestrator must not advance a downstream implementation turn against stale
planning artifacts that do not charter that new increment.

The v2.155.12 dogfood retry proved the dev-role code-production prompt is not
enough by itself: the dev turn reached implementation, saw that M28 was absent
from `PM_SIGNOFF.md`, `ROADMAP.md`, `SYSTEM_SPEC.md`, and `command-surface.md`,
and correctly refused to write source code.

## Interface

Inputs:

- `idle_expansion_result.kind === "new_intake_intent"`
- `idle_expansion_result.new_intake_intent`
- active workflow-kit planning artifacts
- `approval_policy.phase_transitions.default`
- gate metadata for the planning exit gate

Outputs:

- a run state that either:
  - materializes the new intake into the active planning charter before
    implementation dispatch, or
  - keeps the run in planning with a typed blocker that says the new intake has
    not been chartered, or
  - starts a new run whose planning phase explicitly owns chartering the new
    intake before any implementation turn.

Non-output:

- No implementation turn should be dispatched with only a proposed
  `new_intake_intent` and stale planning artifacts from the prior milestone.

## Behavior

1. The orchestrator accepts a valid idle-expansion PM result as a proposal.
2. Before advancing into implementation, it must verify that the proposed
   increment is represented in the active planning artifacts.
3. If the planning artifacts do not mention the proposed increment, the
   orchestrator must not dispatch dev.
4. Under full-auto approval policy, auto-approval may approve a phase transition
   only after the new intake is chartered or explicitly scoped as a
   non-implementation analysis run.
5. The dispatch bundle for dev must include a concrete implementation charter
   derived from approved planning artifacts, not only an idle-expansion proposal.

## Error Cases

- `new_intake_intent` exists but no planning artifact references its title,
  milestone, or acceptance criteria.
- Existing planning artifacts still describe the previous shipped boundary.
- The run is classified as implementation while the current objective is
  analysis/proposal only.
- Dev returns `files_changed` containing only planning notes for a proposed
  source-code increment.

## Acceptance Tests

- AT-BUG70-001: A simulated idle-expansion result with a new intake and stale
  planning artifacts does not dispatch an implementation turn.
- AT-BUG70-002: The blocker message names the missing materialization step and
  does not ask for generic human approval when full-auto policy applies.
- AT-BUG70-003: When the new intake is materialized into planning artifacts,
  the run may auto-advance to implementation under
  `approval_policy.phase_transitions.default: "auto_approve"`.
- AT-BUG70-004: A dev turn for a source-code increment that changes only
  `.planning/IMPLEMENTATION_NOTES.md` is rejected or reissued with a
  code-required failure reason.
- AT-BUG70-005: The tusq.dev dogfood branch produces a non-empty diff under
  `src/`, `tests/`, `bin/`, or `tusq.manifest.json` after the shipped fix.

## Open Questions

- Should idle expansion create a fresh planning run for the proposed intake, or
  mutate the current planning artifacts directly before implementation?
- Should the protocol add a first-class `analysis_only` run type so proposal
  runs cannot be mistaken for implementation runs?
- Should dev code-production enforcement live in accept-turn validation, prompt
  text, or both?
