# Coordinator Next Action Repo Status Spec

## Purpose

Freeze one authority source for coordinator recovery guidance.

`agentxchain multi` next actions, dashboard blocker guidance, and report/audit coordinator recovery text must derive run drift and status drift from the same authority-first child repo status contract used by the dashboard repo rows.

This prevents a private action-only interpretation of repo state where coordinator bookkeeping labels such as `linked` or `initialized` can silently steer `multi resync` or `approve-gate` guidance differently from the rest of the product.

## Interface

- `buildCoordinatorRepoStatusEntries({ config?, coordinatorRepoRuns, repoSnapshots? })`
  - shared child-repo authority surface
  - returns per-repo entries with:
    - displayed `status`, `phase`, `run_id`
    - metadata `details`
    - `run_id_mismatch`
    - `status_drift`
- `deriveCoordinatorNextActions({ status, blockedReason, pendingGate, repos, coordinatorRepoRuns, runIdMismatches? })`
  - ordered coordinator recovery actions
  - must derive status drift from `buildCoordinatorRepoStatusEntries(...)`

## Behavior

1. Child repo authority wins when a governed repo state is readable.
2. Coordinator linkage labels (`linked`, `initialized`) remain metadata only and normalize to `active` when the child repo state is unavailable.
3. `repo_run_id_mismatch` is derived only from shared repo-status entries.
4. `resync` guidance is derived only from shared repo-status entries.
5. If the coordinator is `completed`, no recovery actions are emitted even if terminal drift is still observable.
6. A readable child repo with `status: active` and coordinator linkage `linked` is not status drift.
7. A readable child repo with `status: completed` and coordinator linkage `linked` is status drift and should produce `agentxchain multi resync`.

## Error Cases

- Missing child repo state:
  - action derivation may fall back to normalized coordinator linkage status
  - no fake status drift may be inferred from missing authority
- Missing child repo run id:
  - no fake `repo_run_id_mismatch`
- Missing coordinator repo entry:
  - the shared row still renders repo authority truth; no synthetic drift is created

## Acceptance Tests

- `AT-CNARS-001`: completed coordinator returns no next actions even when shared repo-status entries show drift
- `AT-CNARS-002`: `linked` does not trigger `resync` when the readable child repo is `active`
- `AT-CNARS-003`: readable child repo `completed` vs coordinator `linked` triggers `agentxchain multi resync`
- `AT-CNARS-004`: readable child repo run-id mismatch triggers `agentxchain multi resume`
- `AT-CNARS-005`: `coordinator-next-actions.js` imports the shared repo-status entry builder instead of carrying a private normalization helper

## Open Questions

- None currently. If a future surface needs non-presentational authority metadata beyond `run_id_mismatch` and `status_drift`, extend the shared repo-status entry contract instead of reintroducing private coordinator action logic.
