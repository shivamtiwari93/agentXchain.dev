# BUG-109 Supplemental Checkpoint Recovery Spec

## Purpose

Recover DOGFOOD-100 when an accepted, already-checkpointed turn still owns actor-written files that were present in the turn's observed diff summary but were excluded from `files_changed` by the baseline-dirty unchanged exemption.

BUG-109 was discovered after BUG-108 reverify on `agentxchain@2.155.62`: tusq.dev session `cont-7dc5b5df` reached the QA assignment for `run_083e290f5ee318f4`, but the next QA turn was blocked by dirty actor-owned product files. The latest accepted dev turn `turn_fc4027d5c8789062` was checkpointed, but its history declared only `tests/smoke.mjs` while its accepted summary and observed diff summary showed the retained implementation work also owned `.planning/IMPLEMENTATION_NOTES.md`, `.planning/ROADMAP.md`, `.planning/SYSTEM_SPEC.md`, `.planning/command-surface.md`, `src/cli.js`, `tests/eval-regression.mjs`, `tests/evals/governed-cli-scenarios.json`, and `website/docs/cli-reference.md`.

## Interface

- `detectPendingCheckpoint(root, dirtyFiles)` must detect a checkpointed latest accepted turn that still owns dirty actor files from its `observed_artifact.diff_summary`.
- `checkpointAcceptedTurn(root, { turnId })` must create a supplemental checkpoint for those recoverable files instead of returning `already_checkpointed`.
- Continuous `agentxchain run --continuous --auto-checkpoint` must detect checkpoint-required assignment failures, run the same supplemental checkpoint path, and retry the active run without requiring an operator-side `checkpoint-turn` command.
- History recovery must merge recovered files into `files_changed` and `observed_artifact.files_changed` without dropping previously declared files.

## Behavior

- Supplemental recovery is allowed only when:
  - the latest accepted turn is already checkpointed,
  - there are no active turns,
  - the dirty actor files are all named in the accepted turn's observed diff summary,
  - the dirty actor files are not already declared in `files_changed`,
  - and the accepted turn artifact type supports workspace/patch recovery.
- Next authoritative/proposed assignment must return a checkpoint-required message pointing at `agentxchain checkpoint-turn --turn <turn_id>` instead of a generic commit/stash blocker.
- Running `checkpoint-turn` commits the supplemental dirty files, advances the accepted integration ref, and records `files_changed_recovery_source: "supplemental_dirty_worktree"`.
- In full-auto continuous mode, a checkpoint-required assignment failure is a recoverable maintenance step, not a terminal blocker, when `--auto-checkpoint` is enabled and `checkpointAcceptedTurn` creates a real checkpoint commit.

## Error Cases

- Dirty actor files not named in the latest accepted turn's observed diff summary are not recovered automatically.
- Active turns disable recovery so unrelated in-progress work cannot be silently captured.
- Non-workspace/review artifacts remain non-recoverable.
- Already-clean checkpointed turns still return `already_checkpointed`.
- Continuous auto-checkpoint must not claim recovery when `checkpointAcceptedTurn` returns `already_checkpointed` or `skipped`; it should leave the blocker visible so unrecoverable dirt is not hidden.

## Acceptance Tests

- `BUG-109: checkpointed turn can recover supplemental dirty files from observed diff summary` proves next assignment points at checkpoint-turn, checkpoint-turn creates a supplemental checkpoint, merges the dirty file into history, and leaves the recovered path clean.
- `BUG-109: auto-checkpoint recovers supplemental accepted-turn dirt before QA dispatch retry` proves continuous full-auto parses a checkpoint-required assignment failure, creates the supplemental checkpoint, emits `continuous_auto_checkpoint_recovered`, and retries the same active run.
- Existing pending-checkpoint and checkpoint completeness tests remain passing.

## Open Questions

- The acceptance-time BUG-91 baseline exemption may still be too broad for retained failed-acceptance turns. Supplemental checkpoint recovery fixes the stranded DOGFOOD-100 state and prevents generic assignment deadlocks, but a later hardening pass may need to narrow baseline-dirty exemption semantics before acceptance.
