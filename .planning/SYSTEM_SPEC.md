# System Spec — MW: Workflow Kit Recovery — BUG-78 No-Edit Review Fix

**Run:** `run_5e7a4020b052bc68`
**Baseline:** git:3d53366 (latest checkpoint)
**Package version:** `agentxchain@2.155.72`

## Purpose

Fix BUG-78: when a review-only role (e.g. product_marketing launch readiness) completes a valid no-edit turn and emits `artifact.type: "workspace"` with `files_changed: []`, AgentXchain correctly rejects the inconsistency at Stage C validation (turn-result-validator.js:702), but the continuous loop cannot recover — it pauses and requires manual JSON surgery on `.agentxchain/staging/<turn>/turn-result.json`. This is the last remaining gap in the workflow kit's recovery layer, and it directly blocks the DOGFOOD-100-TURNS credibility gate.

The fix: expand Rule 0a (turn-result-validator.js:1515-1543) to auto-normalize `workspace` → `review` for **completed** no-edit turns, not just turns with explicit lifecycle signals.

This run also formally closes the VISION.md §4 "Workflow Kit" pillar by auditing all 8 workflow concerns and confirming they are delivered with test coverage.

---

## Interface

### Modified Module

```
cli/src/lib/turn-result-validator.js
```

### Rule 0a — Current Behavior (lines 1515-1543)

Auto-normalizes `workspace` → `review` ONLY when ALL of:
- `artifact.type === 'workspace'`
- `files_changed` is empty
- No checkpointable produced files
- AND one of:
  - `context.forceReviewArtifact` (manual `--normalize-artifact-type review`)
  - `hasExplicitNoEditLifecycleSignal` (`run_completion_request: true` OR `phase_transition_request` is set)
  - `status === 'needs_human'` with `proposed_next_role === 'human'`

### Rule 0a — New Behavior (BUG-78 fix)

Auto-normalizes `workspace` → `review` when ALL of:
- `artifact.type === 'workspace'`
- `files_changed` is empty
- No checkpointable produced files
- AND one of:
  - `context.forceReviewArtifact` (manual flag — **unchanged**)
  - `hasExplicitNoEditLifecycleSignal` (lifecycle signal — **unchanged**)
  - `status === 'needs_human'` with `proposed_next_role === 'human'` (**unchanged**)
  - **NEW: `status === 'completed'`** (the common case for review-only turns that BUG-78 manifests)

### Insertion Point

**File:** `cli/src/lib/turn-result-validator.js`
**Line 1523-1527** — The condition block inside Rule 0a:

```javascript
// Current:
    && (
      context.forceReviewArtifact
      || hasExplicitNoEditLifecycleSignal
      || (normalized.status === 'needs_human' && normalized.proposed_next_role === 'human')
    )

// New (BUG-78 fix):
    && (
      context.forceReviewArtifact
      || hasExplicitNoEditLifecycleSignal
      || (normalized.status === 'needs_human' && normalized.proposed_next_role === 'human')
      || normalized.status === 'completed'
    )
```

### Normalization Event Shape (unchanged)

The fix reuses the existing normalization event:
```json
{
  "field": "artifact.type",
  "original_value": "workspace",
  "normalized_value": "review",
  "rationale": "empty_files_changed_no_repo_mutation_declared"
}
```

### Behavioral Guarantee

After this fix, the continuous loop auto-accepts no-edit review turns without human intervention. The normalization is recorded in the turn result's `normalization_events` array, providing full audit trail.

### What Does NOT Change

1. **Stage C validation** (line 696-707) — Still rejects `workspace` with empty `files_changed` when normalization didn't fire. This catches turns with `status: 'blocked'` or `status: 'failed'` where workspace+no-files is a genuine error signal.
2. **Review→workspace guard** (line 716-728) — Still rejects `artifact.type: "review"` with non-empty product file changes.
3. **Implementation-phase product-code guard** (line 733-739) — Still requires product code changes for implementation completion.
4. **Existing normalization triggers** — forceReviewArtifact, lifecycle signals, needs_human still trigger as before.

---

## Dev Charter

### 2.1 Scope

**One file change. One new condition line.**

1. Edit `cli/src/lib/turn-result-validator.js` line 1527: add `|| normalized.status === 'completed'` to the Rule 0a condition
2. Add regression tests in a new test file `cli/test/bug-78-no-edit-review.test.js`

### 2.2 Files Changed (Expected)

| File | Change |
|------|--------|
| `cli/src/lib/turn-result-validator.js` | Add `\|\| normalized.status === 'completed'` to Rule 0a condition (line ~1527) |
| `cli/test/bug-78-no-edit-review.test.js` | New: 6 regression tests for BUG-78 scenarios |

### 2.3 Regression Test Spec

Create `cli/test/bug-78-no-edit-review.test.js` with these tests:

| # | Test ID | Description | Expected |
|---|---------|-------------|----------|
| 1 | AT-WK-001 | Completed turn with workspace+empty files_changed auto-normalizes to review | `normalized.artifact.type === 'review'`, normalization event recorded |
| 2 | AT-WK-002 | Completed turn with workspace+non-empty files_changed is NOT normalized | `normalized.artifact.type === 'workspace'` (unchanged) |
| 3 | AT-WK-003 | Failed turn with workspace+empty files_changed is NOT normalized (status guard) | Stage C validation error fires |
| 4 | AT-WK-004 | Blocked turn with workspace+empty files_changed is NOT normalized (status guard) | Stage C validation error fires |
| 5 | AT-WK-005 | Completed turn with workspace+empty files_changed but checkpointable produced_files is NOT normalized | `normalized.artifact.type === 'workspace'` (produced_files guard intact) |
| 6 | AT-WK-006 | Full validation pipeline: completed no-edit turn passes Stage C after normalization | `validation.ok === true` |

### 2.4 Architecture Invariants

1. **No new imports.** The fix adds one condition line to an existing if-block.
2. **No behavioral change for turns with files_changed.** Only empty-files_changed turns are affected.
3. **No behavioral change for non-completed turns.** Only `status === 'completed'` triggers the new path.
4. **Normalization is auditable.** The existing `normalizationEvents` array records the correction.
5. **Stage C remains the safety net.** Non-normalized turns still fail Stage C validation.

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
cd cli && npx vitest run test/workflow-gate-semantics.test.js test/gate-evaluator.test.js

# QA verification
cd cli && npx vitest run test/bug-78-no-edit-review.test.js
cd cli && npx vitest run test/workflow-gate-semantics.test.js test/gate-evaluator.test.js
cd cli && npx vitest run test/turn-result-validator.test.js
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
7. [ ] Normalization events array records the workspace→review correction
