# BUG-87: Undeclared Verification Output Auto-Normalization

## Purpose

When a governed dev turn declares verification commands (e.g., `npm test`, `node bin/tusq.js surface plan --help`) and those commands produce side-effect files (e.g., `.tusq/plan.json`) that the agent does not classify under `verification.produced_files`, acceptance currently hard-errors with `undeclared_verification_outputs` and blocks the continuous loop indefinitely. The operator must perform manual `jq` surgery on staging JSON to add the missing `produced_files` entry.

This spec defines a two-layer fix: (1) auto-normalize undeclared verification outputs by classifying them as `disposition: "ignore"` and cleaning them up before dirty parity rechecks, and (2) prompt-harden role templates so agents declare produced files proactively.

## Root Cause

1. Dev prompts do not document the `verification.produced_files` contract — agents don't know it exists.
2. The framework detects the violation correctly (`undeclared_verification_outputs`) but has no recovery path — the continuous loop blocks permanently.
3. This is the BUG-55 family recurring under a new generated-output path. BUG-55 added the detection; BUG-87 adds the recovery.

## Interface

### Auto-normalization (in `governed-state.js` `_acceptGovernedTurnLocked`)

When `detectDirtyFilesOutsideAllowed` returns `clean: false` AND verification was declared:

1. Collect `unexpected_dirty_files` from the parity check.
2. For each unexpected dirty file, check against the dispatch baseline (`currentTurn.baseline.dirty_snapshot`):
   - If the file was NOT dirty at dispatch time → it was produced during this turn (verification side effect).
   - If the file WAS dirty at dispatch time → it predates this turn and cannot be auto-classified.
3. For files produced during this turn: auto-classify as `verification.produced_files` with `disposition: "ignore"`.
4. Clean them up using `restoreCleanPath()` (delete untracked files, `git restore` tracked ones).
5. Re-run `detectDirtyFilesOutsideAllowed` to confirm the tree is now clean.
6. If still dirty after cleanup → fall through to the existing hard-error path.
7. Emit `verification_output_auto_normalized` event with the list of auto-classified files and their original state.

### Prompt hardening (in dispatch-bundle.js and role templates)

Add to dev, qa, pm, and product_marketing role prompt injection:

```text
If your verification commands produce side-effect files (e.g., tool outputs in hidden directories like `.tusq/`, `coverage/`, `.cache/`), declare each under verification.produced_files with disposition "ignore" (for temporary outputs to clean up) or "artifact" (for outputs to checkpoint). Undeclared dirty files with declared verification commands will trigger acceptance failure.
```

## Behavior

### Happy path (agent declares produced_files correctly)
No change — existing `normalizeVerificationProducedFiles()` handles it.

### Recovery path (agent omits produced_files)
1. Dirty parity check fails with unexpected files.
2. Verification is confirmed declared.
3. Each unexpected file is checked against baseline — files not in baseline are turn-produced.
4. Turn-produced files are cleaned up (git restore / rm).
5. Dirty parity re-checked — if clean, acceptance proceeds.
6. `verification_output_auto_normalized` event emitted.

### Non-recovery path (files were dirty before the turn)
If unexpected dirty files were already present at dispatch baseline, they cannot be auto-classified (they predate the turn). Hard-error with existing `undeclared_verification_outputs` message.

## Error Cases

- **Auto-cleanup fails** (file cannot be restored): fall through to hard-error with existing message.
- **Files remain dirty after cleanup**: fall through to hard-error.
- **Baseline not available** (`currentTurn.baseline` is null): skip auto-normalization, fall through to hard-error.
- **Mixed case** (some files turn-produced, some pre-existing): auto-classify only turn-produced files; if pre-existing dirty files remain, hard-error.

## Acceptance Tests

1. Dev turn with declared verification + `.tusq/plan.json` dirty and not in `files_changed` → auto-normalized, cleaned up, acceptance succeeds. `verification_output_auto_normalized` event emitted.
2. Dev turn with declared verification + source file dirty and not in `files_changed` (file not in baseline) → auto-normalized, cleaned up (the file was produced by verification, not by intentional edit). Acceptance succeeds.
3. Dev turn with no verification declared + dirty file → existing `artifact_dirty_tree_mismatch` error (unchanged behavior).
4. Dev turn with declared verification + file that WAS dirty at baseline → hard-error with `undeclared_verification_outputs` (cannot auto-classify pre-existing dirt).
5. BUG-55 existing tests still pass (undeclared file WITH no auto-normalization candidate — file was dirty at baseline).

## Open Questions

None — this follows the established BUG-78/79 normalizer pattern.
