# Coordinator Dashboard Timeout Repo Status Spec

## Purpose

Freeze the coordinator timeout dashboard contract so repo timeout cards use the same authority-first repo status surface as other coordinator views instead of privately re-deriving child run state and hiding run drift.

## Interface

- `GET /api/coordinator/timeouts`
  - Returns per-repo timeout snapshots plus coordinator timeout summary/event data.
  - Each repo snapshot carries dashboard-ready repo status presentation fields:
    - `status`
    - `phase`
    - `run_id`
    - `details[]`
- `cli/dashboard/components/coordinator-timeouts.js`
  - Renders the per-repo timeout cards from the shared repo-status presentation contract.

## Behavior

- Per-repo timeout cards must use child repo `.agentxchain/state.json` as the primary source of `status`, `phase`, and `run_id` when the child repo snapshot is readable.
- Coordinator linkage labels such as `linked` and `initialized` are metadata only. They may appear under repo details, but not as the primary repo status badge.
- When coordinator and repo-local `run_id` disagree, the timeout card keeps the repo-local `run_id` as primary truth and surfaces the coordinator `expected run` as monospace detail metadata.
- Timeout-specific data remains attached to the repo snapshot:
  - timeout config
  - live timeout pressure
  - timeout event history
- Repo error cards must still preserve the repo-status presentation details so operators can see coordinator linkage/drift context even when child governed state is missing.

## Error Cases

- Missing coordinator config: `404 coordinator_config_missing`
- Invalid coordinator config: `422 coordinator_config_invalid`
- Missing coordinator state: `404 coordinator_state_missing`
- Missing child repo config or state: repo snapshot includes `error` while preserving repo-status presentation metadata when available

## Acceptance Tests

- `AT-CDTRS-001`: `GET /api/coordinator/timeouts` returns authority-first repo status fields and preserves coordinator linkage as detail metadata on repo timeout snapshots.
- `AT-CDTRS-002`: Coordinator Timeouts renders authority-first repo status while still showing coordinator linkage / expected-run metadata on the repo card.
- `AT-CDTRS-003`: Source guards keep coordinator timeout snapshots on the shared repo-status presenter instead of private `repoRun.status` / `repoRun.phase` fallback formatting.
- `AT-CDTRS-004`: CLI docs describe coordinator timeout cards as authority-first child repo status with coordinator linkage/drift metadata.

## Open Questions

- None.
