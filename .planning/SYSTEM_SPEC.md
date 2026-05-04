# System Spec — MW: Workflow Kit Recovery — BUG-78 No-Edit Review Fix (Formal Closure)

**Run:** `run_cf572ef2d54d357d`
**Baseline:** git:c8c558a1e (latest checkpoint)
**Package version:** `agentxchain@2.155.72`

## Purpose

Formally close BUG-78 and ROADMAP.md:116-117. The code fix was delivered in prior run `run_5e7a4020b052bc68`: Rule 0a in turn-result-validator.js (line 1527) now auto-normalizes `workspace` -> `review` for **completed** no-edit turns, not just turns with explicit lifecycle signals. Six regression tests (AT-WK-001 through AT-WK-006) were delivered in `cli/test/bug-78-no-edit-review.test.js`.

This run verifies the fix remains in place, updates all planning artifacts to reference the correct run, and provides QA ship verdict to check off the roadmap items.

---

## Interface

### Modified Module (delivered in prior run)

```
cli/src/lib/turn-result-validator.js
```

### Rule 0a — Current Behavior (line 1527, fix already in place)

Auto-normalizes `workspace` -> `review` when ALL of:
- `artifact.type === 'workspace'`
- `files_changed` is empty
- No checkpointable produced files
- AND one of:
  - `context.forceReviewArtifact` (manual `--normalize-artifact-type review`)
  - `hasExplicitNoEditLifecycleSignal` (`run_completion_request: true` OR `phase_transition_request` is set)
  - `status === 'needs_human'` with `proposed_next_role === 'human'`
  - `status === 'completed'` (BUG-78 fix — the common case for review-only turns)

### Normalization Event Shape (unchanged)

```json
{
  "field": "artifact.type",
  "original_value": "workspace",
  "normalized_value": "review",
  "rationale": "empty_files_changed_no_repo_mutation_declared"
}
```

### What Does NOT Change

1. **Stage C validation** (line 696-707) — Still rejects `workspace` with empty `files_changed` when normalization didn't fire
2. **Review->workspace guard** (line 716-728) — Still rejects `artifact.type: "review"` with non-empty product file changes
3. **Implementation-phase product-code guard** (line 733-739) — Still requires product code changes for implementation completion
4. **Existing normalization triggers** — forceReviewArtifact, lifecycle signals, needs_human still trigger as before

---

## Dev Charter

### Scope

**Verification-only. No new code changes.**

1. Re-run `cli/test/bug-78-no-edit-review.test.js` — 6 tests must pass
2. Re-run `cli/test/turn-result-validator.test.js cli/test/workflow-gate-semantics.test.js cli/test/gate-evaluator.test.js` — 152 tests must pass
3. Confirm Rule 0a at line 1527 still contains `|| normalized.status === 'completed'`

### Files Changed (Expected)

None. This is a verification-only run. The dev turn should set `artifact.type: "review"` and `files_changed: []`.

### Architecture Invariants

1. **No new imports** — Fix was one condition line in an existing if-block
2. **No behavioral change for turns with files_changed** — Only empty-files_changed turns affected
3. **No behavioral change for non-completed turns** — Only `status === 'completed'` triggers the new path
4. **Normalization is auditable** — Existing `normalizationEvents` array records the correction
5. **Stage C remains the safety net** — Non-normalized turns still fail Stage C validation

---

## Acceptance Tests

| # | Test ID | Description | Expected |
|---|---------|-------------|----------|
| 1 | AT-WK-001 | Completed workspace+empty files normalizes to review | PASS |
| 2 | AT-WK-002 | Completed workspace+non-empty files NOT normalized | PASS |
| 3 | AT-WK-003 | Failed workspace+empty files NOT normalized | PASS |
| 4 | AT-WK-004 | Blocked workspace+empty files NOT normalized | PASS |
| 5 | AT-WK-005 | Completed workspace+empty files+produced_files NOT normalized | PASS |
| 6 | AT-WK-006 | Full validation: completed no-edit passes Stage C | PASS |
| 7 | AT-WK-007 | Existing workflow-gate-semantics tests still pass | PASS |
| 8 | AT-WK-008 | Existing gate-evaluator tests still pass | PASS |

---

## Verification Commands

```bash
# Dev verification
cd cli && npx vitest run test/bug-78-no-edit-review.test.js
cd cli && npx vitest run test/turn-result-validator.test.js test/workflow-gate-semantics.test.js test/gate-evaluator.test.js

# QA verification (same + turn-result-validator.test.js for regression)
cd cli && npx vitest run test/bug-78-no-edit-review.test.js
cd cli && npx vitest run test/turn-result-validator.test.js test/workflow-gate-semantics.test.js test/gate-evaluator.test.js
```

---

## Key Architecture Invariants (Verification Checklist)

QA should confirm each invariant still holds:

1. [ ] Rule 0a fires for `status === 'completed'` + empty files_changed + workspace artifact
2. [ ] Rule 0a does NOT fire for `status === 'failed'` or `status === 'blocked'`
3. [ ] Rule 0a does NOT fire when files_changed is non-empty
4. [ ] Rule 0a does NOT fire when checkpointable produced_files exist
5. [ ] Stage C validation (line 702) still rejects non-normalized workspace+empty turns
6. [ ] Existing tests in workflow-gate-semantics.test.js and gate-evaluator.test.js still pass
7. [ ] Normalization events array records the workspace->review correction
