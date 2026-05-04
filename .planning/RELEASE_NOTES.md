# Release Notes — MW: Workflow Kit Recovery — BUG-78 No-Edit Review Fix

**Run:** run_cf572ef2d54d357d
**Version:** agentxchain@2.155.72

## What's New

### BUG-78: No-Edit Review Turn Auto-Normalization

Review-only roles (e.g. product_marketing, security_reviewer, technical_writer) that complete valid no-edit analysis turns no longer get stuck at Stage C validation. The turn-result validator's Rule 0a now auto-normalizes `artifact.type: "workspace"` to `"review"` when a completed turn has empty `files_changed` and no checkpointable produced files.

**Before:** Completed no-edit turns emitting `workspace` with `files_changed: []` were rejected at Stage C ("workspace but files_changed is empty"), requiring manual JSON surgery on the staging turn-result to continue the governed run.

**After:** Rule 0a detects the inconsistency and auto-corrects `workspace` → `review`, recording the normalization in the auditable `normalizationEvents` array. The continuous loop proceeds without manual intervention.

### Guards Preserved

- **Status guard**: Only `completed` turns are normalized. `failed` and `blocked` turns still hit Stage C as before.
- **Files guard**: Turns with non-empty `files_changed` are never normalized — they legitimately declared workspace changes.
- **Produced files guard**: Turns with checkpointable `verification.produced_files` entries are not normalized — they have artifacts to checkpoint even without repo mutations.
- **Implementation guard**: The implementation-phase product-code guard (line 733) is fully independent of Rule 0a. Authoritative implementation turns still require product code changes regardless of normalization.

## Files Changed

| File | Change | Description |
|------|--------|-------------|
| `cli/src/lib/turn-result-validator.js` | Modified | Rule 0a (line 1527): added `\|\| normalized.status === 'completed'` to normalization trigger |
| `cli/test/bug-78-no-edit-review.test.js` | New | 7 regression tests (AT-WK-001 through AT-WK-007) |
| `cli/test/turn-result-validator.test.js` | Modified | 2 existing tests updated: status `completed` → `blocked` to preserve Stage C coverage |

## Test Results

- 7/7 BUG-78 regression tests pass (AT-WK-001 through AT-WK-007)
- 152/152 validator + gate tests pass (turn-result-validator, workflow-gate-semantics, gate-evaluator)
- 0 new failures introduced

## User Impact

Operators running governed multi-agent runs in continuous mode no longer need to manually edit turn-result JSON when review-only roles emit `artifact.type: "workspace"` with no file changes. This was the last remaining gap in the workflow kit's recovery layer, directly unblocking the DOGFOOD-100-TURNS credibility gate. The fix is a one-line condition expansion with zero behavioral change for turns that declare file changes or have non-completed status.

## Verification Summary

QA independently verified all 8 SYSTEM_SPEC acceptance criteria (AT-WK-001 through AT-WK-008):

- **Normalization** (AT-WK-001): Completed workspace + empty files_changed correctly auto-normalizes to review, with normalization event recorded.
- **Files guard** (AT-WK-002): Non-empty files_changed prevents normalization.
- **Status guard** (AT-WK-003, AT-WK-004): Failed and blocked turns are NOT normalized.
- **Produced files guard** (AT-WK-005): Checkpointable produced_files prevent normalization.
- **Full pipeline** (AT-WK-006): Completed no-edit QA turn passes Stage C after normalization.
- **Independence** (AT-WK-007): Implementation-phase guard independently rejects even after normalization — proves the two constraints are decoupled.
- **Regression** (AT-WK-008): 152 existing validator + gate tests pass with 0 failures.

Test execution: 7/7 bug-78-no-edit-review.test.js, 152/152 combined validator+gate suites. Total 159 tests, 0 failures. Exit code 0 for all commands.
