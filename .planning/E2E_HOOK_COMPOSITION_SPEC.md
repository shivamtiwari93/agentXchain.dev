# E2E Hook Composition Specification

> Validates that repo-local hooks compose correctly across the governed lifecycle, including post-validation, pre-acceptance, and human gate approvals.

---

## Purpose

Prove that the hook system works as a lifecycle contract, not just as isolated phase wiring. Existing hook coverage already demonstrates a blocking `before_validation`, advisory `after_acceptance`, and `on_escalation` exclusion behavior. The remaining risk is composition drift across the phases that are easiest to miss in happy-path testing:

- `after_validation`
- `before_acceptance`
- `before_gate`
- blocked gate replay after a `before_gate` failure

This spec closes that gap with a library-level E2E that drives a real governed run through both human approval gates and asserts that audit artifacts reflect the exact hook order and gate context.

---

## Interface

This spec introduces no new production interfaces. It exercises existing governed primitives and audit ledgers:

```typescript
initializeGovernedRun(root, config)
assignGovernedTurn(root, config, roleId)
acceptGovernedTurn(root, config)
approvePhaseTransition(root, config)
approveRunCompletion(root, config)
```

Files asserted by the test:

- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/hook-audit.jsonl`
- `.agentxchain/hook-annotations.jsonl`

Primary test location:

- `cli/test/e2e-hook-composition.test.js`

---

## Behavior

### Scenario

1. Copy `examples/governed-todo-app` to a temp directory and initialize a real git repository.
2. Configure process hooks for:
   - `before_assignment`
   - `before_validation`
   - `after_validation`
   - `before_acceptance`
   - `after_acceptance`
   - `before_gate`
3. Initialize a governed run and assign the planning turn.
4. Accept the PM turn with a phase transition request to `implementation`.
5. Approve the planning gate with `approvePhaseTransition(root, config)` so `before_gate` is exercised for a phase transition.
6. Commit orchestrator-generated files so the authoritative dev turn still respects the clean-baseline rule.
7. Assign and accept the dev turn, including a real source-file change, then auto-advance to `qa`.
8. Assign and accept the QA turn with `run_completion_request: true`.
9. Approve run completion with `approveRunCompletion(root, config)` so `before_gate` is exercised for run completion.
10. Assert:
    - every accepted turn records the expected phase order in `hook-audit.jsonl`
    - `before_acceptance` sees the observed change count from the orchestrator
    - `before_gate` records both `phase_transition` and `run_completion`
    - only `after_acceptance` writes to `hook-annotations.jsonl`
    - `history.jsonl` remains orchestrator-owned and hook-free
11. In a separate replay scenario, let a blocking `before_gate` hook reject the planning approval once.
12. Assert the run is `blocked`, the phase has not advanced, and `pending_phase_transition` is still present with recovery pointing back to `agentxchain approve-transition`.
13. Fix the hook and rerun `approvePhaseTransition(root, config)`.
14. Assert the replayed approval succeeds and clears the blocked state without losing the original pending approval context.

### Hook Semantics Under Test

- `before_validation` may warn and still allow acceptance to continue
- `after_validation` receives the validation verdict after the five-stage validation pipeline runs
- `before_acceptance` receives observed change classification from the orchestrator, not the raw declared `files_changed` list alone
- `before_gate` runs only for human approval paths and must distinguish `phase_transition` from `run_completion`
- a `before_gate` block must fail closed without consuming the pending approval; the same approval command must remain replayable after the hook is fixed

---

## Error Cases

1. If `after_validation` does not fire after a successful validation pass, the test fails because lifecycle composition regressed.
2. If `before_acceptance` does not receive the orchestrator-observed file-change classification, the test fails because the hook payload contract drifted.
3. If `before_gate` does not fire for both human gate approvals, the test fails because approval-hook coverage is incomplete.
4. If hook annotations appear in `history.jsonl`, the test fails because hooks mutated orchestrator-owned history.
5. If the per-turn audit order is not `before_validation -> after_validation -> before_acceptance -> after_acceptance`, the test fails because hook sequencing changed.
6. If a `before_gate` block clears `pending_phase_transition` or makes `approvePhaseTransition(root, config)` unusable after the hook is fixed, the test fails because approval recovery is broken.

---

## Acceptance Tests

1. The lifecycle completes with `state.status = "completed"`.
2. `before_assignment` fires exactly once per assigned turn.
3. `before_validation`, `after_validation`, `before_acceptance`, and `after_acceptance` each fire exactly once per accepted turn.
4. `before_gate` fires once for planning approval and once for run completion approval.
5. Each accepted turn has a hook-audit phase order of `before_validation`, `after_validation`, `before_acceptance`, `after_acceptance`.
6. The dev turn's `before_acceptance` hook sees one observed file change.
7. `hook-annotations.jsonl` contains only `after_acceptance` output.
8. `history.jsonl` contains exactly three accepted turns and no hook metadata fields.
9. A blocked `before_gate` approval leaves `pending_phase_transition` intact and preserves the original phase.
10. After the blocking hook is fixed, rerunning `approvePhaseTransition(root, config)` advances the phase and clears the blocked state.

---

## Open Questions

1. Once the library-level proof is complete, do we also need a CLI-subprocess hook-composition smoke test, or is the current command integration coverage sufficient?
