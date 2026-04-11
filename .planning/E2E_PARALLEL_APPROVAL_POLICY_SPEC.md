# E2E Parallel Approval-Policy Lifecycle Spec

> Governed subprocess proof for parallel phase work plus policy-driven phase advancement and completion.

## Purpose

AgentXchain already has:

- parallel turn assignment and targeted acceptance
- approval-policy auto-approval
- governed run completion
- governance export/report surfaces

What it does **not** yet prove is that these surfaces compose truthfully in one governed run:

1. a sequential planning gate auto-approves into a parallel phase
2. two different roles in the same phase are active concurrently
3. the final acceptance in that phase auto-advances only because both roles participated
4. the final QA gate auto-completes the run
5. the governance report preserves those approval-policy events

This slice closes that gap.

## Interface

New subprocess test:

- `cli/test/e2e-parallel-approval-policy-lifecycle.test.js`

Fixture shape:

- template: `cli-tool`
- phases:
  - `planning`
  - `implementation`
  - `qa`
- implementation phase:
  - `max_concurrent_turns: 2`
  - two roles assigned concurrently:
    - `dev` on `local_cli`
    - `integrator` on `manual`
- approval policy:
  - `planning -> implementation`: `auto_approve` when `gate_passed: true`
  - `implementation -> qa`: `auto_approve` when `gate_passed: true` and `roles_participated: ["dev", "integrator"]`
  - run completion: `auto_approve` when `gate_passed: true` and `all_phases_visited: true`

Operator surfaces exercised:

- `agentxchain init`
- `agentxchain step`
- `agentxchain accept-turn --turn <id>`
- `agentxchain export --output <file>`
- `agentxchain report --input <file> --format json`
- `agentxchain status`

Library setup allowed in the parallel phase:

- `assignGovernedTurn(...)`
- `writeDispatchBundle(...)`

That is intentional. The current CLI has no clean operator-level “spawn two active turns at once and dispatch both live” surface. This proof is about governed state-machine truth, not fake live-concurrency marketing.

## Behavior

1. Initialize a governed `cli-tool` fixture and patch `agentxchain.json` for:
   - a new `reviewer` role
   - `implementation.max_concurrent_turns = 2`
   - `implementation_complete.requires_human_approval = true`
   - the approval-policy rules above
2. Run a real planning turn through `agentxchain step --poll 1`.
3. Stage planning artifacts and request `implementation`.
4. Verify the run auto-advances to `implementation` and records one `approval_policy` ledger event.
5. Assign `dev` and `reviewer` concurrently through governed-state library helpers and write both dispatch bundles.
6. Accept the `dev` turn first through `agentxchain accept-turn --turn <dev_turn_id>`.
   - The run must stay in `implementation`
   - The queued phase transition must remain pending internally
   - No second approval-policy event yet
7. Accept the `integrator` turn second through `agentxchain accept-turn --turn <integrator_turn_id>`.
   - The run must auto-advance to `qa`
   - The second approval-policy event must show the matched rule requiring `roles_participated: ["dev", "integrator"]`
8. Run the final QA turn through `agentxchain step --poll 1`.
9. Stage QA gate artifacts and request run completion.
10. Verify the run auto-completes and records a third `approval_policy` event.
11. Export the governed run and build a governance report.
12. Verify the report includes all three `approval_policy_events` with matched-rule detail preserved.

## Error Cases

1. If the first implementation acceptance auto-advances immediately, the proof is invalid; the policy must wait for both roles.
2. If the second implementation acceptance does not auto-advance, `roles_participated` or queued phase-transition replay is broken.
3. If run completion pauses for human approval, `all_phases_visited` or final gate replay is broken.
4. If export preserves policy entries but report drops them, the reporting surface regressed again.
5. If a `review_only` role is substituted into the parallel implementation phase, artifact observation will correctly treat the authoritative sibling's product edits as part of the review-only turn's observed workspace delta. That is outside this slice's contract.
6. If this test requires live adapter dispatch to pass, the proof boundary is wrong. This slice is not a live multi-runtime network proof.

## Acceptance Tests

1. `AT-PAP-001`: Planning auto-advances to `implementation` and writes one `approval_policy` event.
2. `AT-PAP-002`: Two concurrent implementation turns can be assigned with different runtime IDs and dispatch bundles.
3. `AT-PAP-003`: Accepting the first implementation turn does not leave the phase.
4. `AT-PAP-004`: Accepting the second implementation turn auto-advances to `qa`.
5. `AT-PAP-005`: The implementation-to-QA approval-policy event preserves `roles_participated: ["dev", "integrator"]`.
6. `AT-PAP-006`: QA requests run completion and the run auto-completes without `approve-completion`.
7. `AT-PAP-007`: The final governance report contains three `approval_policy_events` with matched-rule detail.

## Open Questions

1. Should the CLI eventually expose a first-class operator command for assigning additional active turns without test-only library setup?
2. Do we want a later live proof for actual concurrent dispatch across different adapter types, or is governed-state composition enough for the current claim?
