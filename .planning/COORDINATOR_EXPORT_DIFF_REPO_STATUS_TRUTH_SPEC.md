# Coordinator Export Diff Repo Status Truth Spec

**Status**: shipped

## Purpose

Keep coordinator export diff and regression detection aligned with the same authority-first child repo status contract already used by dashboard, `multi`, and report/audit surfaces.

The diff must not treat coordinator linkage labels like `linked` or `initialized` as child repo truth when a nested child export is available. That creates false repo-status changes and false regressions.

## Interface

```bash
agentxchain diff <left_export.json> <right_export.json> --export [--json]
agentxchain verify diff <left_export.json> <right_export.json> [--format text|json]
```

## Behavior

1. Coordinator export diffs must derive per-repo status changes from authority-first child repo status entries, not directly from `summary.repo_run_statuses`.
2. When `repos.<id>.ok === true` and a nested child export is present, the child export summary status is the authority status for diff/regression purposes.
3. `summary.repo_run_statuses` remains visible as coordinator metadata only. JSON diff output may preserve it separately, but it must not be the primary repo-status comparison contract.
4. `linked` and `initialized` must normalize to `active` before status-drift comparisons, matching the shipped coordinator repo-status presentation contract.
5. If nested child authority is unavailable for a repo, diff may fall back to the normalized coordinator status for that repo instead of inventing missing data.
6. Repo-status regressions must use the authority-first status map. A stale coordinator summary alone must not create `REG-REPO-STATUS-*`.

## Error Cases

1. If a repo export is unreadable or `ok === false`, the diff must not pretend child authority exists for that repo.
2. If the compared artifacts are not coordinator exports, this spec does not apply.
3. If either export fails verification, `verify diff` still fails before diff semantics matter.

## Acceptance Tests

1. `AT-COORD-STATUS-TRUTH-001`: linkage-only summary drift (`linked` -> `active`) with unchanged child export status does not produce a repo-status change or regression.
2. `AT-COORD-STATUS-TRUTH-002`: stale coordinator summary failure does not create a repo-status regression when the child export authority still reports the prior status.
3. `AT-ED-003B`: CLI export diff JSON exposes authority-first `repo_statuses` and preserves raw coordinator linkage metadata separately.

## Open Questions

None.
