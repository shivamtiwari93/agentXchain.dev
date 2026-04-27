# BUG-91: Baseline-dirty unchanged files block turn acceptance

## Purpose

Files that were already dirty when a turn was dispatched (captured in `baseline.dirty_snapshot` with SHA256 markers) and have NOT been modified during the turn (same SHA at acceptance time) should not block acceptance. The turn did not create or modify these files — they are inherited workspace state.

## Discovery

DOGFOOD-100-TURNS strict session `cont-d83c9d81` (later `cont-96045989`), run `run_8580d828f0e1cc1e`, turn `turn_c3e78ecd352330aa` (dev). The dogfood evidence protocol writes `.planning/dogfood-100-turn-evidence/turn-counter.jsonl` to the tusq.dev working tree between turns. This file is dirty at dispatch baseline. At acceptance, `detectDirtyFilesOutsideAllowed()` flags it as unexpected because it's not in `files_changed`. BUG-87's auto-normalization skips it (correctly: it was dirty at baseline, not a verification output). Acceptance fails:

```
Verification was declared (commands or machine_evidence), but these files are dirty and not classified: .planning/dogfood-100-turn-evidence/turn-counter.jsonl.
```

## Root Cause

The acceptance dirty-parity check at `governed-state.js:4507` computes allowed files as:
- `turnResult.files_changed`
- concurrent allowed dirty files
- uncheckpointed prior turn files

It does NOT include files from `baseline.dirty_snapshot` that are unchanged. The SHA-comparison logic already exists in `repo-observer.js:filterBaselineDirtyFiles()` but is only used for observation attribution, not acceptance parity.

## Fix

### Layer 1 — Export `getBaselineUnchangedFiles()` from `repo-observer.js`

New exported function: given `root` and `baseline`, returns file paths whose SHA marker matches the baseline `dirty_snapshot`. These files were dirty when the turn started and haven't been modified.

### Layer 2 — Add baseline-unchanged files to allowed set in `governed-state.js`

Before the `detectDirtyFilesOutsideAllowed()` call at acceptance time, compute baseline-unchanged files and include them in the allowed set. This prevents false-positive dirty-parity failures on inherited workspace state.

Emit `baseline_dirty_unchanged_excluded` audit event when files are excluded, with file paths and SHA markers preserved for traceability.

### Layer 3 — Preserve BUG-87 safety boundary

Files that were dirty at baseline but whose SHA CHANGED during the turn are NOT excluded — the turn modified them and they need classification. This preserves BUG-55/BUG-87's protection against undeclared mutations.

## Behavior

| File State | Acceptance Behavior |
|---|---|
| Not in baseline dirty_snapshot, now dirty, not declared | FAIL (undeclared mutation) |
| In baseline dirty_snapshot, same SHA at acceptance | PASS (inherited, unchanged) |
| In baseline dirty_snapshot, different SHA at acceptance | FAIL (turn modified without declaring) |
| In baseline dirty_snapshot, declared in files_changed | PASS (correctly declared) |

## Acceptance Tests

1. Turn dispatched with `.planning/dogfood-100-turn-evidence/turn-counter.jsonl` dirty at baseline, unchanged at acceptance → acceptance succeeds.
2. Turn dispatched with a file dirty at baseline, file content changes during turn but not declared → acceptance fails with `undeclared_verification_outputs` or `artifact_dirty_tree_mismatch`.
3. Turn dispatched with a file dirty at baseline, file declared in `files_changed` → acceptance succeeds (existing behavior, no regression).
4. BUG-55 and BUG-87 existing tests still pass — unchanged baseline exclusion does not regress their protections.
