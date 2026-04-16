# Coordinator Dashboard Repo Status Spec

## Purpose

Freeze one dashboard contract for coordinator repo rows so Initiative and Blocked stop treating coordinator linkage labels as repo truth.

## Interface

- `GET /api/coordinator/repo-status`
  - Returns dashboard-ready coordinator repo status rows derived from:
    - coordinator config repo order
    - coordinator `repo_runs`
    - child repo `.agentxchain/state.json` authority when available
- `cli/dashboard/components/initiative.js`
  - Consumes `coordinatorRepoStatusRows`
- `cli/dashboard/components/blocked.js`
  - Consumes `coordinatorRepoStatusRows`

## Behavior

- Primary repo `status`, `phase`, and `run_id` come from child repo state when the child repo snapshot is readable.
- Coordinator-only labels such as `linked` and `initialized` are metadata, not the primary repo status.
- When coordinator and repo-local `run_id` disagree, the row keeps repo-local `run_id` as primary truth and surfaces coordinator `expected run` as detail metadata.
- Initiative and Blocked must share the same row contract instead of privately formatting `repo_runs`.
- Renderers may fall back to the shared repo-row presenter without repo snapshots when the dedicated API payload is absent, but they may not fall back to raw `repoRun.status` / `repoRun.phase` strings.

## Error Cases

- Missing coordinator config: `404 coordinator_config_missing`
- Invalid coordinator config: `422 coordinator_config_invalid`
- Missing coordinator state: `404 coordinator_state_missing`

## Acceptance Tests

- `AT-CDRS-001`: `GET /api/coordinator/repo-status` returns authority-first rows and preserves coordinator linkage as detail metadata.
- `AT-CDRS-002`: Initiative renders repo-authority rows and does not degrade to raw `linked` / `initialized` repo status text.
- `AT-CDRS-003`: Blocked renders the same repo-authority rows and does not privately stringify coordinator `repo_runs`.
- `AT-CDRS-004`: Dashboard app fetch contracts include `coordinatorRepoStatusRows` for Initiative and Blocked.
- `AT-CDRS-005`: Source guards keep Initiative and Blocked on the shared repo-row presenter instead of raw `repoRun.status` / `repoRun.phase` formatting.

## Open Questions

- None.
