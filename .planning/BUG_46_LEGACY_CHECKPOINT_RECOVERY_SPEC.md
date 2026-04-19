**Status:** Shipped — implementation complete; BUG-46 remains open pending tester verification per discipline rule #12

# BUG-46 Legacy Checkpoint Recovery

## Purpose

Unstick repos that were already stranded by the pre-fix BUG-46 acceptance bug.

The forward fix rejects or classifies new empty-`files_changed` authoritative turns correctly. That does not repair a run that was already accepted on `v2.140.0` with `files_changed: []` while the working tree still contains actor-owned files. This spec freezes the safe recovery boundary for `checkpoint-turn` and pending-checkpoint detection.

## Interface

- `checkpoint-turn --turn <turn_id>`
- `detectPendingCheckpoint(root, dirtyFiles)`

No new operator command is introduced in v1. Recovery happens inside the existing checkpoint path when the target turn satisfies the safety contract below.

## Behavior

1. Legacy recovery is only allowed when all of the following are true:
   - the accepted history entry has no checkpoint SHA
   - normalized `files_changed` is empty
   - `artifact.type` is `workspace` or `patch`
   - the target turn is the latest accepted turn in history
   - there are no active turns in state
   - the current actor-owned dirty files are non-empty
2. When recovery triggers, the actor-owned dirty files become the effective checkpoint file set.
3. `checkpoint-turn` persists the repaired `files_changed` back into history before staging the checkpoint commit.
4. Repaired history records:
   - `files_changed`
   - `files_changed_recovered_at`
   - `files_changed_recovery_source: "legacy_dirty_worktree"`
   - `observed_artifact.files_changed` when an observed artifact record exists
5. `detectPendingCheckpoint()` must treat the repaired dirty-file set as checkpointable so the operator gets the checkpoint guidance instead of a generic dirty-baseline refusal.
6. Review artifacts are never auto-recovered from dirty files.
7. Non-latest accepted turns are never auto-recovered from dirty files.

## Error Cases

- Active turns exist: recovery is unsafe and must not trigger.
- Dirty actor files are empty: there is nothing to recover; checkpoint skips as before.
- Dirty actor files include unrelated later edits on a non-latest turn: recovery is forbidden by the latest-turn gate.
- Review artifact with empty `files_changed`: no recovery; checkpoint skips.

## Acceptance Tests

1. A latest accepted workspace turn whose history was manually corrupted to `files_changed: []` is recovered by `checkpoint-turn`, committed, and persisted with recovery metadata.
2. `detectPendingCheckpoint()` returns `required: true` and a legacy-recovery message for the same stranded latest-turn shape.
3. Operational paths remain excluded from the repaired file set.
4. The recovery path does not invent a new command or require a human-side git commit.

## Open Questions

1. If future evidence shows operators need to repair non-latest accepted turns, add an explicit operator-confirmed repair command instead of widening the automatic recovery heuristic.
