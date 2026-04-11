# Coordinator Timeout Dashboard Surface Spec

## Purpose

Add coordinator-level timeout visibility to the dashboard so multi-repo operators can see timeout pressure and timeout history across child repos without manually inspecting each repo's `.agentxchain/decision-ledger.jsonl`.

## Interface

### API Endpoint

`GET /api/coordinator/timeouts`

Returns:

```json
{
  "ok": true,
  "super_run_id": "srun_123",
  "status": "active",
  "phase": "implementation",
  "summary": {
    "repo_count": 2,
    "configured_repo_count": 1,
    "repos_with_live_exceeded": 1,
    "repos_with_live_warnings": 0,
    "repo_event_count": 3,
    "coordinator_event_count": 0
  },
  "coordinator_events": [],
  "repos": [
    {
      "repo_id": "api",
      "path": "./repos/api",
      "run_id": "run_api_001",
      "status": "active",
      "phase": "implementation",
      "configured": true,
      "config": {
        "per_phase_minutes": 60,
        "action": "warn",
        "phase_overrides": []
      },
      "live": {
        "exceeded": [],
        "warnings": [
          {
            "scope": "turn",
            "phase": "implementation",
            "turn_id": "turn_api_001",
            "role_id": "dev",
            "limit_minutes": 30,
            "elapsed_minutes": 42,
            "exceeded_by_minutes": 12,
            "action": "warn"
          }
        ]
      },
      "events": []
    }
  ]
}
```

- `summary` is aggregate-only. It does not flatten repo identity into top-level event rows.
- `coordinator_events` are derived only from `.agentxchain/multirepo/decision-ledger.jsonl`.
- `repos[].events` are derived from each child repo's `.agentxchain/decision-ledger.jsonl`.
- `repos[].live` is computed server-side from each child repo's current config/state. Phase/run scopes are evaluated once per repo, and each active turn adds its own turn-scoped row with `turn_id` and `role_id`.

### Frontend View

12th nav item: `Coordinator Timeouts`

Dashboard component: `cli/dashboard/components/coordinator-timeouts.js`

Render sections:
1. Header with `super_run_id`, status, and current phase
2. Aggregate summary counts
3. Coordinator timeout events section
4. One card per repo with config, live pressure, and repo-local timeout events

## Behavior

- The endpoint fails closed when coordinator config/state is missing or invalid.
- Child repo timeout semantics are reused as-is. The dashboard does not invent coordinator-specific timeout rules for repos.
- The coordinator view must preserve turn identity. Operators need to know which active child-repo turn is over budget; aggregated turn pressure without `turn_id` is insufficient.
- Repo cards may show `configured: false` when a child repo has no `timeouts` section.
- Repo cards may show repo-specific error state when a governed child repo exists in coordinator config but its runtime state file is missing.

## Error Cases

- No `agentxchain-multi.json`: `404 coordinator_config_missing`
- Invalid coordinator config: `422 coordinator_config_invalid`
- No coordinator state: `404 coordinator_state_missing`
- Per-repo missing state: repo card renders an error instead of crashing the full view

## Acceptance Tests

1. `readCoordinatorTimeoutStatus()` returns aggregate summary plus per-repo snapshots.
2. Child repos with `timeouts` config surface live phase/run exceeded-warning results.
3. Child repos with active turns surface turn-scoped live rows with `turn_id` / `role_id`.
4. Child repos without `timeouts` config surface `configured: false`.
5. Coordinator timeout events render separately from child repo events.
6. Repo-level missing state becomes a repo-card error, not a global endpoint failure.
7. Dashboard nav includes `Coordinator Timeouts`.
8. `app.js` registers `coordinator-timeouts` with `/api/coordinator/timeouts`.
9. Bridge server routes `/api/coordinator/timeouts`.
10. CLI dashboard docs mention the 12th view and the endpoint.

## Open Questions

None. This slice is observability only; it does not add new coordinator timeout semantics.
