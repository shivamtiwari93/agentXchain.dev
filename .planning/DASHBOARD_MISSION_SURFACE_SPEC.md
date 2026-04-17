# Dashboard Mission Surface Spec

## Purpose

Make the single-repo mission layer visible in the live dashboard so operators can see long-horizon grouping above chained runs without dropping back to `agentxchain mission show` or opening raw `.agentxchain/missions/*.json` artifacts.

This surface must stay distinct from the existing multi-repo **Initiative** view. `Mission` is repo-local hierarchy above chain sessions; `Initiative` remains coordinator hierarchy across repositories.

## Interface

- HTTP: `GET /api/missions`, `GET /api/plans` (with optional `?mission=<id>` filter)
- Dashboard top-level view: `Mission` (includes plan visibility)
- Data sources:
  - `.agentxchain/missions/*.json`
  - `.agentxchain/missions/plans/<mission_id>/*.json`
  - `.agentxchain/reports/chain-*.json`
  - `.agentxchain/repo-decisions.jsonl`

Response shape:

```json
{
  "latest": {
    "mission_id": "mission-release-hardening",
    "title": "Release hardening",
    "goal": "Unify release truth",
    "derived_status": "progressing",
    "chain_count": 2,
    "attached_chain_count": 2,
    "missing_chain_ids": [],
    "total_runs": 5,
    "total_turns": 14,
    "latest_chain_id": "chain-abc12345",
    "latest_terminal_reason": "chain_limit_reached",
    "active_repo_decisions_count": 3,
    "chains": []
  },
  "missions": []
}
```

## Behavior

- `GET /api/missions` returns mission snapshots newest-first by `updated_at`, with `latest` set to the first mission in that ordering or `null` when none exist.
- `GET /api/plans` returns plan snapshots newest-first across all missions. Each plan summary includes `workstreams` (with per-workstream `launch_status`), `launch_records` (with chain linkage), and `workstream_status_counts`. Optional `?mission=<id>` filters to a single mission.
- The `Mission` dashboard view renders:
  - the latest mission identity, goal, derived status, chain totals, run totals, turn totals, latest chain id, latest terminal reason, and active repo-decision count
  - an attached-chain table for the latest mission showing newest-first chain lineage summaries
  - the latest decomposition plan with plan status, workstream count, workstream table (ID, title, launch status, roles, phases, dependencies), and launch records table (workstream → chain linkage, status, terminal reason, timestamps)
  - empty-state guidance for plans when none exist
  - previous plans table for older/superseded plans
  - a recent-missions table showing newest-first mission summaries
- The `Mission` view is repo-local only. It must not reuse coordinator `initiative` terminology or pretend multi-repo coordinator data is mission data.
- The dashboard file watcher must invalidate `Mission` when `.agentxchain/missions/*.json` changes.
- The watcher must also invalidate `Mission` when `.agentxchain/reports/chain-*.json` changes because mission snapshots derive chain summaries from those reports.
- The watcher must invalidate both `/api/plans` and `/api/missions` when `.agentxchain/missions/plans/**/*.json` changes. This uses recursive watching because plan files are nested under dynamic per-mission subdirectories.
- Missing referenced chain reports must degrade the mission summary instead of crashing the endpoint. The surface must expose the missing chain count/IDs so operators can see the drift.
- Malformed mission artifacts are skipped, not fatal.

## Error Cases

- No missions: endpoint returns `{ latest: null, missions: [] }`; dashboard renders an empty-state message pointing operators to `agentxchain mission start`.
- Mission references missing chain reports: endpoint still returns the mission snapshot with `derived_status: "degraded"` and populated `missing_chain_ids`.
- Unparseable mission file: ignored so one bad advisory artifact does not blank the whole surface.
- Missing `.agentxchain/missions/`: same behavior as no missions.

## Acceptance Tests

- `AT-DASH-MISSION-001`: `GET /api/missions` returns newest-first mission snapshots and `latest`.
- `AT-DASH-MISSION-002`: dashboard `Mission` view renders latest-mission summary plus attached-chain lineage and recent mission summaries.
- `AT-DASH-MISSION-003`: dashboard shell/nav/docs include `Mission` as a shipped top-level view and document `/api/missions` and `/api/plans`.
- `AT-DASH-MISSION-004`: dashboard invalidation maps `missions/*.json` to `/api/missions` and keeps chain-report invalidation shared with mission derivation.
- `AT-DASH-PLAN-001`: `GET /api/plans` returns newest-first plan snapshots with workstream and launch detail.
- `AT-DASH-PLAN-002`: `GET /api/plans?mission=<id>` filters plans by mission.
- `AT-DASH-PLAN-003`: Mission view renders latest plan detail with workstreams and launch records.
- `AT-DASH-PLAN-004`: Mission view renders empty plan state with guidance command.
- `AT-DASH-PLAN-005`: `app.js` wires plans API and fetches plans for mission view.
- `AT-DASH-PLAN-006`: plan file invalidation watches `missions/plans` recursively and maps to `/api/plans` + `/api/missions`.

## Open Questions

- None. Mission remains the repo-local hierarchy noun above chained runs; coordinator `initiative` remains a separate product surface.
