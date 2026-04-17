# Manual Dispatch Examples Spec

## Purpose

Make the manual adapter's inline `turn-result.json` example truthful for the current phase and write authority.

The audit exposed that the implementation-phase example still showed a review-style artifact and `verification.status: "skipped"` even when the active gate required a passing verification and the role had authoritative write access. That is operator-facing drift: the prompt bundle says one thing, the manual template nudges the operator toward another, and the first full lifecycle becomes guesswork.

## Interface

- CLI/manual adapter output:
  - `cli/src/lib/adapters/manual-adapter.js`
- Regression tests:
  - `cli/test/step-command.test.js`

## Behavior

1. The manual adapter example must derive `artifact.type` from the role's write authority:
   - `review_only` -> `review`
   - `authoritative` -> `workspace`
   - `proposed` -> `patch`
2. When the active phase exit gate requires verification to pass and the role is not `review_only`, the example must show `verification.status: "pass"` with placeholder commands/evidence.
3. The output must include a short `To exit this phase cleanly:` section that tells the operator what matters for the current phase.
4. When the phase has a clear next phase, the example should default `phase_transition_request` to that next phase.
5. For the final QA phase, the example should default `run_completion_request` to `true`.

## Error Cases

- Do not show `artifact.type: "review"` for authoritative manual turns.
- Do not show `verification.status: "skipped"` when the current exit gate requires verification pass.
- Do not hardcode `phase_transition_request: null` for phases that have an obvious next-phase handoff in the normalized routing order.

## Acceptance Tests

- `AT-MDE-001`: planning/manual-review output includes the phase exit guidance section and defaults `phase_transition_request` to `implementation`.
- `AT-MDE-002`: implementation/manual-authoritative output uses `artifact.type: "workspace"`, shows `verification.status: "pass"`, and defaults `phase_transition_request` to `qa`.
- `AT-MDE-003`: QA/manual-review output keeps `artifact.type: "review"` and defaults `run_completion_request` to `true`.

## Open Questions

- Whether the manual adapter should also surface a stronger warning when an authoritative example uses `workspace` but the current repo is already dirty before dispatch.
