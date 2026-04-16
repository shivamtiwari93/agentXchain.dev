# Dashboard Chain Surface Spec

## Purpose

Make run-chaining visible in the live dashboard so operators do not have to open raw `.agentxchain/reports/chain-*.json` files or leave the browser for basic chain lineage inspection.

## Interface

- HTTP: `GET /api/chain-reports`
- Dashboard top-level view: `Chain`
- Data source: `.agentxchain/reports/chain-*.json`

Response shape:

```json
{
  "latest": {
    "chain_id": "chain-abc12345",
    "started_at": "2026-04-16T23:00:00.000Z",
    "completed_at": "2026-04-16T23:09:00.000Z",
    "terminal_reason": "chain_limit_reached",
    "total_turns": 9,
    "total_duration_ms": 540000,
    "runs": []
  },
  "reports": []
}
```

## Behavior

- `GET /api/chain-reports` returns all readable chain reports newest-first by `started_at`.
- `latest` is the first readable report in that same ordering, or `null` when none exist.
- The `Chain` dashboard view renders:
  - latest chain id, total runs, total turns, duration, terminal reason, start, completion
  - a per-run lineage table for the latest chain with run status, provenance trigger, parent run id, and inherited-context summary
  - a recent chain sessions table showing newest-first chain reports
- The dashboard file watcher must invalidate `Chain` when `.agentxchain/reports/chain-*.json` changes.
- Malformed chain report files are skipped, not fatal.

## Error Cases

- No chain reports: endpoint returns `{ latest: null, reports: [] }`; dashboard renders an empty-state message pointing operators to `agentxchain run --chain`.
- Unparseable report file: ignored so one bad advisory file does not blank the whole surface.
- Missing `.agentxchain/reports/`: same behavior as no reports.

## Acceptance Tests

- `AT-DASH-CHAIN-001`: `GET /api/chain-reports` returns newest-first reports and `latest`.
- `AT-DASH-CHAIN-002`: dashboard `Chain` view renders latest-chain summary plus per-run lineage fields.
- `AT-DASH-CHAIN-003`: dashboard shell/nav/docs include `Chain` as a shipped top-level view and document `/api/chain-reports`.
- `AT-DASH-CHAIN-004`: dashboard invalidation maps `reports/chain-*.json` to `/api/chain-reports`.

## Open Questions

- None. This surface is repo-local only and intentionally advisory, matching the chain-report contract.
