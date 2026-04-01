# E2E Smoke Test Specification — Governed v1

> Validates the full governed lifecycle without a live LLM. Uses the example project and mock staged turn results.

---

## Purpose

Prove that the governed orchestration chain works end-to-end: init → resume → stage mock result → validate → accept → phase transition → completion. This is the single most important pre-dogfood validation because it exercises every command, every state transition, and every file write in sequence — something no unit test does.

---

## Approach

A single Node.js test file (`cli/test/e2e-governed-lifecycle.test.js`) that:

1. Copies `examples/governed-todo-app` to a temp directory
2. Initializes a git repo (required for baseline capture)
3. Commits orchestrator-generated files before assigning the `authoritative` dev turn so the clean-baseline rule is satisfied
4. Walks through the full 3-phase lifecycle using the library functions directly (not shelling out to the CLI binary), to keep test speed fast and assertions precise
5. Verifies state.json, history.jsonl, decision-ledger.jsonl, and TALK.md at each checkpoint

This is a **library-level integration test**, not a subprocess test. It imports the same functions the CLI commands call.

---

## Lifecycle Under Test

### Phase 1: Planning (manual PM turn)

1. Call `initializeGovernedRun()` — verify run_id assigned, status=active, phase=planning
2. Call `assignGovernedTurn()` for role=pm — verify current_turn exists
3. Write a mock `turn-result.json` to staging with:
   - status: completed
   - decisions: [{id: "D-001", summary: "MVP scope defined", status: "accepted"}]
   - objections: [{id: "OBJ-001", severity: "low", summary: "Scope risk", status: "open"}] (required for review_only + challenge_required)
   - artifact: {type: "review", path: ".planning/PM_SIGNOFF.md"}
   - phase_transition_request: "implementation"
4. Call `validateStagedTurnResult()` — verify passes
5. Call `acceptGovernedTurn()` — verify:
   - current_turn cleared
   - history.jsonl has 1 entry
   - decision-ledger.jsonl has 1 entry
   - state.status = "paused" (phase transition requires approval)
   - state.pending_phase_transition = {from: "planning", to: "implementation", ...}
6. Simulate `approve-transition` — verify phase=implementation, status ready for next turn
7. Commit orchestrator-generated files so the worktree is clean before assigning the `authoritative` dev turn

### Phase 2: Implementation (local_cli dev turn)

8. Assign dev turn
9. Stage mock result with:
   - status: completed
   - files_changed: ["src/index.js"]
   - artifact: {type: "commit", ref: "abc1234"}
   - phase_transition_request: "qa"
10. Validate and accept
11. Verify phase auto-advances to `qa` because `implementation_complete` requires passing verification but does not require human approval
12. Optionally commit orchestrator-generated files again to anchor the accepted implementation before QA review

### Phase 3: QA (api_proxy QA turn)

13. Assign qa turn
14. Stage mock result with:
    - status: completed
    - verification: {status: "pass", details: "All 5 criteria met"}
    - run_completion_request: true
15. Validate and accept
16. Verify state.status = "paused", pending_run_completion exists
17. Simulate `approve-completion` — verify status=completed, completed_at set

### Final assertions

- history.jsonl has exactly 3 entries (one per phase)
- decision-ledger.jsonl has entries from all 3 turns
- state.json status=completed
- TALK.md contains prose from all 3 accepted turns

---

## Interface

```typescript
// No new interfaces — uses existing governed-state.js, turn-result-validator.js,
// dispatch-bundle.js, and gate-evaluator.js functions.
```

---

## Error Cases Tested

1. Double-assignment rejected (call assignGovernedTurn twice without accepting)
2. Invalid staged result rejected (missing required field)
3. Phase transition without approval stays paused
4. run_completion_request + phase_transition_request in same result rejected

---

## Acceptance Tests (meta — these are the assertions in the test itself)

1. Full 3-phase lifecycle completes with status=completed
2. history.jsonl contains exactly 3 accepted entries
3. Planning transition and run completion require and respect approval
4. Implementation to QA auto-advances when verification passes
5. The test commits orchestrator-generated files before assigning the `authoritative` dev turn
6. All state transitions match STATE_MACHINE_SPEC.md
7. No files left in staging after final acceptance

---

## Open Questions

1. Should this test also verify TALK.md prose content, or just that it was appended to?
2. Should we add a parallel "unhappy path" E2E that exercises reject → retry → escalation?
