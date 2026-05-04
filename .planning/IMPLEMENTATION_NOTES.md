# Implementation Notes — MW: Workflow Kit Recovery — BUG-78 No-Edit Review Fix

**Run:** `run_cf572ef2d54d357d` (formal closure run; code delivered in `run_5e7a4020b052bc68`)
**Code Delivery Turn:** `turn_7f509cddfd9d064b` (prior run)
**Verification Turn:** `turn_fb61d81381433de5` (prior run)
**Role:** dev
**Date:** 2026-05-04

## What Was Built

Fixed BUG-78: when a review-only role completes a valid no-edit turn emitting `artifact.type: "workspace"` with `files_changed: []`, the turn-result validator's Rule 0a now auto-normalizes `workspace` → `review` for completed turns. Previously this only fired for `needs_human` status or explicit no-edit lifecycle signals, leaving completed no-edit turns stuck at Stage C validation with no auto-recovery path.

This is a one-line condition expansion plus 6 regression tests — the last gap blocking the DOGFOOD-100-TURNS credibility gate.

## Changes

**`cli/src/lib/turn-result-validator.js`** — Modified (1 line added):
- Rule 0a condition block (line 1527): added `|| normalized.status === 'completed'` to the normalization trigger conditions. This allows completed turns with empty `files_changed` and no checkpointable produced files to auto-normalize from `workspace` to `review`.

**`cli/test/bug-78-no-edit-review.test.js`** — New (6 tests):
- AT-WK-001: Completed workspace + empty files_changed normalizes to review
- AT-WK-002: Completed workspace + non-empty files_changed is NOT normalized (files guard)
- AT-WK-003: Failed workspace + empty files_changed is NOT normalized (status guard)
- AT-WK-004: Blocked workspace + empty files_changed is NOT normalized (status guard)
- AT-WK-005: Completed workspace + empty files + checkpointable produced_files is NOT normalized (produced_files guard)
- AT-WK-006: Full validation pipeline — completed no-edit QA turn passes Stage C after normalization

**`cli/test/turn-result-validator.test.js`** — Modified (2 existing tests updated):
- "rejects review_only role with non-review artifact type" — changed `status: 'completed'` to `status: 'blocked'` so the BUG-78 normalization doesn't fire and Stage C coverage is preserved
- "rejects authoritative workspace artifact with no files_changed" — same status change for the same reason

## Challenges to Prior Turn

The prior dev turn (turn_7f509cddfd9d064b) delivered correct code and all 6 regression tests pass. However, it did not update `.planning/IMPLEMENTATION_NOTES.md` — the file still described run_685ea79f49acd469 (M9: CI Pipeline Integration). This turn rewrites it for the current run.

## Verification

1. **BUG-78 regression tests**: `cd cli && npx vitest run test/bug-78-no-edit-review.test.js` — 6/6 pass
2. **Validator + gate test suites**: `cd cli && npx vitest run test/turn-result-validator.test.js test/workflow-gate-semantics.test.js test/gate-evaluator.test.js` — 152/152 pass across 2 suites
3. **Total**: 158 tests, 0 failures

## Architecture Invariants Maintained

1. **No new imports** — Fix is one condition line in an existing if-block
2. **No behavioral change for turns with files_changed** — Only empty-files_changed turns affected (AT-WK-002)
3. **No behavioral change for non-completed turns** — Only `status === 'completed'` triggers (AT-WK-003, AT-WK-004)
4. **Normalization is auditable** — Existing `normalizationEvents` array records the correction (AT-WK-001)
5. **Stage C remains the safety net** — Non-normalized turns still fail Stage C validation
6. **Stage C workspace-empty guard (line 696-707)** — Still rejects `workspace` with empty `files_changed` when normalization didn't fire
7. **Review→workspace guard (line 716-728)** — Still rejects `artifact.type: "review"` with non-empty product file changes
8. **Implementation-phase product-code guard (line 733-739)** — Still requires product code changes for implementation completion
