# Coordinator Report Repo Status Truth Spec

**Status:** shipped
**Decision:** `DEC-COORDINATOR-REPORT-REPO-STATUS-001`

## Purpose

Coordinator report and audit surfaces must not regress into presenting coordinator bookkeeping labels like `linked` and `initialized` as the child repo truth.

The dashboard and multi-repo CLI already moved to an authority-first child repo status contract. Report and audit must use that same contract for status counts and drift narration, or operators will get conflicting answers depending on which surface they open.

## Interface

For `subject.kind = coordinator_workspace`:

```js
subject.run.repo_status_counts: Record<string, number>
subject.run.repo_status_drifts: Array<{
  repo_id: string,
  coordinator_status: string | null,
  repo_status: string | null,
}>
```

## Behavior

1. `subject.run.repo_status_counts` must be derived from the shared authority-first child repo status entries, not from `summary.repo_run_statuses`.
2. When child repo authority is readable, the counted status must come from the child repo export/state.
3. Coordinator linkage labels like `linked` and `initialized` may remain visible as metadata on other surfaces, but they must not become the primary counted report status when repo authority exists.
4. `subject.run.repo_status_drifts` must expose status disagreements between coordinator state and child repo authority using the shared repo-status contract.
5. Public report/audit docs must say this boundary explicitly: `summary.repo_run_statuses` remains raw coordinator snapshot metadata, while report/audit status counts and drift use authority-first child repo status when child authority is readable.
6. Text, markdown, and HTML report/audit output must render repo-status drift details when present.

## Error Cases

- If a child repo export is unreadable, the report may fall back to normalized coordinator state (`linked` / `initialized` normalize to `active`) for that repo's counted status.
- If there is no status drift, `subject.run.repo_status_drifts` must be an empty array.

## Acceptance Tests

- `AT-COORD-REPORT-STATUS-001`: coordinator report JSON derives `repo_status_counts` from authority-first child repo status instead of `summary.repo_run_statuses`.
- `AT-COORD-REPORT-STATUS-002`: coordinator report JSON exposes `subject.run.repo_status_drifts` with coordinator-vs-repo status detail.
- `AT-COORD-REPORT-STATUS-003`: text, markdown, and HTML report surfaces render repo-status drift details.
- `AT-COORD-REPORT-STATUS-004`: public report/audit docs freeze the snapshot-vs-operator-truth boundary (`summary.repo_run_statuses` metadata vs authority-first report/audit status counts and `repo_status_drifts`).

## Open Questions

None. This aligns report/audit with the already-set shared coordinator repo-status contract.
