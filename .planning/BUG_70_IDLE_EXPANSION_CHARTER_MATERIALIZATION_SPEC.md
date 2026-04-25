# BUG-70 — Idle Expansion Charter Materialization Contract

## Purpose

Prevent perpetual idle-expansion loops from producing planning-only implementation
turns or human-only scope escalations under full-auto policy. When an
idle-expansion PM turn emits `kind: "new_intake_intent"`, the orchestrator must
not advance a downstream implementation turn against stale planning artifacts
that do not charter that new increment, and must not treat the PM's request for
human scope confirmation as a real blocker when the configured mode is
full-auto idle expansion.

The v2.155.12 dogfood retry proved the dev-role code-production prompt is not
enough by itself: the dev turn reached implementation, saw that M28 was absent
from `PM_SIGNOFF.md`, `ROADMAP.md`, `SYSTEM_SPEC.md`, and `command-surface.md`,
and correctly refused to write source code.

## Interface

Inputs:

- `idle_expansion_result.kind === "new_intake_intent"`
- `idle_expansion_result.new_intake_intent`
- `turn_result.status`, including `completed` and `needs_human`
- `turn_result.needs_human_reason`
- active workflow-kit planning artifacts
- `approval_policy.phase_transitions.default`
- `approval_policy.run_completion.action`
- gate metadata for the planning exit gate

Outputs:

- a run state that either:
  - materializes the new intake into the active planning charter before
    implementation dispatch, or
  - keeps the run in planning with `charter_materialization_pending` so the
    next PM turn must write/update planning artifacts, or
  - starts a new run whose planning phase explicitly owns chartering the new
    intake before any implementation turn.
- a `charter_materialization_required` run event naming the suppressed
  transition or suppressed human-only intake approval.

Non-output:

- No implementation turn should be dispatched with only a proposed
  `new_intake_intent` and stale planning artifacts from the prior milestone.
- No human escalation should be created solely because an idle-expansion PM
  asked a human to approve accepting the new intake while full-auto policy is
  active.

## Behavior

1. The orchestrator accepts a valid idle-expansion PM result as a proposal.
2. Before advancing into implementation, it must verify that the proposed
   increment is represented in the active planning artifacts.
3. If the planning artifacts do not mention the proposed increment, the
   orchestrator must not dispatch dev.
4. If the idle-expansion PM returned `phase_transition_request`, the transition
   is suppressed until the charter materialization turn is accepted.
5. If the idle-expansion PM returned `status: "needs_human"` for new-intake
   scope confirmation under full-auto policy, the human blocker is suppressed
   and converted into `charter_materialization_pending`.
6. Pre-acceptance gate semantic coverage must not reject a
   `new_intake_intent` phase-transition request before the materialization guard
   can store `charter_materialization_pending`; the missing PM gate files are
   the expected reason materialization is required.
7. While `charter_materialization_pending` is active, routing must ignore the
   idle-expansion turn's proposed implementation role and send the next planning
   turn back to the proposing planning role so that role materializes the
   PM-owned charter artifacts.
8. Under full-auto approval policy, auto-approval may approve a phase transition
   only after the new intake is chartered or explicitly scoped as a
   non-implementation analysis run.
9. The dispatch bundle for dev must include a concrete implementation charter
   derived from approved planning artifacts, not only an idle-expansion proposal.

## Error Cases

- `new_intake_intent` exists but no planning artifact references its title,
  milestone, or acceptance criteria.
- Existing planning artifacts still describe the previous shipped boundary.
- The run is classified as implementation while the current objective is
  analysis/proposal only.
- PM returns `status: "needs_human"` for a new idle-expansion intake despite
  the repo running full-auto.
- PM returns `phase_transition_request: "implementation"` for a new
  idle-expansion intake while PM gate artifacts still describe the previous
  milestone; this must become materialization rather than a semantic-coverage
  failed-acceptance turn.
- PM proposes `proposed_next_role: "dev"` while materialization is still pending;
  the orchestrator must not dispatch dev in the planning phase to write PM-owned
  planning artifacts.
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
- AT-BUG71-001: An idle-expansion `new_intake_intent` result with
  `status: "needs_human"` and no `phase_transition_request` is accepted as an
  active planning-state materialization requirement, leaves `blocked_on` null,
  keeps `next_recommended_role` on PM, and emits
  `charter_materialization_required` with `suppressed_needs_human: true`.
- AT-BUG72-001: An idle-expansion `new_intake_intent` result with
  `phase_transition_request: "implementation"` is not failed by pre-acceptance
  gate semantic coverage solely because the PM-owned gate files were not
  modified; acceptance stores `charter_materialization_pending` and leaves the
  run in planning.
- AT-BUG73-001: If an idle-expansion `new_intake_intent` result also proposes
  `proposed_next_role: "dev"`, acceptance still sets `next_recommended_role` to
  the proposing planning role so the materialization turn is routed to PM before
  implementation.

## Open Questions

- Should idle expansion create a fresh planning run for the proposed intake, or
  mutate the current planning artifacts directly before implementation?
- Should the protocol add a first-class `analysis_only` run type so proposal
  runs cannot be mistaken for implementation runs?
- Should dev code-production enforcement live in accept-turn validation, prompt
  text, or both?
- Should the suppression of `needs_human` require explicit full-auto policy
  detection, or is `new_intake_intent` from the idle-expansion lane itself
  sufficient proof that the orchestrator owns materialization?
