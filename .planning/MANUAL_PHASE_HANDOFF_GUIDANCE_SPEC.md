# Manual Phase Handoff Guidance Spec

## Purpose

Keep the manual-governed cold-start path honest when a review-only phase advances into an authoritative phase.

The planning flow can accept review artifacts and queue a human-approved phase transition without creating a new git checkpoint. That is valid. The adoption bug is that `approve-transition` previously told the operator to run `agentxchain step` immediately, even when the next phase's entry role would fail the clean-baseline check because the accepted planning artifacts were still uncommitted.

## Interface

- CLI command: `agentxchain approve-transition`
- Supporting logic:
  - `cli/src/commands/approve-transition.js`
  - `cli/src/lib/role-resolution.js`
  - `cli/src/lib/repo-observer.js`
- Regression tests:
  - `cli/test/operator-recovery.test.js`

## Behavior

1. `approve-transition` still advances the phase when the gate approval is valid.
2. After approval, the command resolves the next role for the target phase using the same role-resolution contract as `step`.
3. If that next role is `authoritative` or `proposed`, `approve-transition` must run the clean-baseline check before printing the next-step guidance.
4. When the baseline is dirty in actor-owned files, the command must not pretend `agentxchain step` is immediately runnable.
5. Instead, it must print:
   - that the next turn is blocked until the workspace is checkpointed
   - the clean-baseline reason
   - a concrete checkpoint hint (`git add -A && git commit ...`)
   - the `agentxchain step` command as the follow-up after the checkpoint

## Error Cases

- Do not block `approve-transition` itself just because the next phase would fail the clean-baseline rule. Approval and operator guidance are separate concerns.
- Do not print the checkpoint warning for review-only next roles.
- Do not resolve the next role with ad hoc phase-entry logic that diverges from `step`.

## Acceptance Tests

- `AT-MPHG-001`: a pending `planning -> implementation` approval with dirty planning artifacts still advances the phase.
- `AT-MPHG-002`: the same approval prints a checkpoint warning when the next entry role is authoritative.
- `AT-MPHG-003`: the warning includes the clean-baseline reason plus explicit `git add -A && git commit ...` and `agentxchain step` follow-up guidance.

## Open Questions

- Whether `status` should also surface the same checkpoint warning when no active turn exists and the next authoritative phase is blocked on a dirty baseline.
