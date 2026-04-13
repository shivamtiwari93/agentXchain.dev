# Release Gate E2E Spec

## Purpose

Prove that the release notes gate (`qa_ship_verdict`) enforces semantic validation of `.planning/RELEASE_NOTES.md` through real subprocess CLI invocations — not just library function imports.

The existing `release-notes-gate.test.js` validates the `evaluateWorkflowGateSemantics()` function directly. This spec adds the missing subprocess E2E layer: proving that an operator running `agentxchain gate show qa_ship_verdict --evaluate` and the governed lifecycle's `acceptGovernedTurn()` both correctly reject placeholder release notes and accept real ones.

## Interface

Two subprocess E2E test surfaces:

1. **Gate evaluation via CLI** (`agentxchain gate show qa_ship_verdict --evaluate --json`)
   - Proves the gate inspect command surfaces semantic failures for placeholder content
   - Proves the gate inspect command reports pass for real content

2. **Governed lifecycle rejection** (full `init → assign → accept` flow)
   - Proves that a QA turn with `run_completion_request: true` and placeholder RELEASE_NOTES.md causes the turn acceptance to block (gate files present but semantically invalid)
   - Proves that after fixing the release notes content, the same turn succeeds

## Behavior

### Gate CLI Evaluation

- `gate show qa_ship_verdict --evaluate --json` on a fresh governed scaffold → `evaluation.passed === false`, `semantic_failures` includes release notes placeholder reason
- After writing real `## User Impact` and `## Verification Summary` content → `evaluation.passed` improves (may still fail on other artifacts, but release notes semantic failure disappears)

### Lifecycle Rejection Path

- Initialize governed run, advance through planning → implementation → qa
- In QA phase, write placeholder RELEASE_NOTES.md with `(QA fills this during the QA phase)` content
- Stage a turn result with `run_completion_request: true`
- `acceptGovernedTurn()` should either reject the turn or block the completion because the gate semantic validation fails on the release notes content
- Replace placeholder content with real content
- Re-attempt should succeed

## Error Cases

- Missing RELEASE_NOTES.md entirely → gate reports file missing (already covered by gate-evaluator unit tests, but E2E should confirm)
- RELEASE_NOTES.md with only `## User Impact` filled → gate fails on `## Verification Summary` placeholder

## Acceptance Tests

- `AT-RELEASE-E2E-001`: `gate show qa_ship_verdict --evaluate --json` on scaffold reports release notes semantic failure
- `AT-RELEASE-E2E-002`: `gate show qa_ship_verdict --evaluate --json` with real release notes content clears release notes semantic failure
- `AT-RELEASE-E2E-003`: governed lifecycle blocks run completion when RELEASE_NOTES.md has placeholder content
- `AT-RELEASE-E2E-004`: governed lifecycle allows run completion when RELEASE_NOTES.md has real content

## Open Questions

None — the gate semantics are already frozen in `workflow-gate-semantics.js` and the lifecycle is proven in `e2e-governed-lifecycle.test.js`. This spec only adds the missing subprocess proof layer.
