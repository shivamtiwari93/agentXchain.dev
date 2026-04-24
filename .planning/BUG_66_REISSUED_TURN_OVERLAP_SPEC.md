# BUG-66: Reissued Turns Trigger Overlap Acceptance Conflicts

## Purpose

Prevent reissued turns from triggering false-positive overlap detection when the replacement turn produces similar content to the failed original.

## Root Cause

`classifyAcceptanceOverlap()` in `governed-state.js` iterates through **all** history entries to detect file-level overlap conflicts. It filters by `run_id` and `assigned_sequence` but does NOT filter by `status`. When a turn is reissued:

1. `reissueTurn()` archives the old turn to `history.jsonl` with `status: 'reissued'`
2. The replacement turn naturally produces similar files (same role, same phase, same work)
3. On acceptance, `classifyAcceptanceOverlap()` finds the reissued history entry's `observed_artifact.files_changed` overlapping with the new turn's files
4. This triggers a conflict with high `overlap_ratio`, blocking acceptance with `suggested_resolution: 'human_merge'`

## Fix

In `classifyAcceptanceOverlap()`, add two skip conditions before the existing filters:

1. **Skip reissued entries**: `if (entry.status === 'reissued') continue` — reissued turns are superseded, not competing. Their archived observations are historical, not conflict surfaces.

2. **Skip direct predecessor entries**: `if (targetTurn.reissued_from === entry.turn_id) continue` — even if a reissued entry has a different status (edge case), the direct predecessor of a replacement turn should never cause overlap against it.

## Behavior

| Scenario | Before | After |
|---|---|---|
| Reissued turn replacement accepted with similar files | `file_conflict` with high `overlap_ratio` → blocks | No conflict — reissued entries skipped |
| Normal concurrent turns with overlapping files | Conflict detected correctly | Same — only `status: 'reissued'` skipped |
| Reissued turn with `--resolution human_merge` | Works (bypasses conflict) | Still works, but conflict is not raised in the first place |

## Acceptance Tests

1. History entry with `status: 'reissued'` is skipped in overlap detection
2. History entry matching `targetTurn.reissued_from` is skipped
3. Non-reissued history entries with overlapping files still trigger conflict (regression guard)
