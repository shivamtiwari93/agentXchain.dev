# Timeout Dashboard Surface Spec

## Purpose

Add timeout visibility to the governed dashboard through the `Timeouts` nav item. Operators can observe live timeout pressure on active runs, observe read-only phase/run timeout pressure during approval waits, review persisted timeout events from the decision ledger, and understand recovery actions without leaving the dashboard.

## Interface

### API Endpoint

`GET /api/timeouts` — computed endpoint (like `/api/workflow-kit-artifacts` and `/api/connectors`).

Returns:
```json
{
  "ok": true,
  "configured": true,
  "config": {
    "per_turn_minutes": 30,
    "per_phase_minutes": 120,
    "per_run_minutes": 480,
    "action": "escalate"
  },
  "live": {
    "exceeded": [],
    "warnings": [
      {
        "scope": "turn",
        "phase": "implementation",
        "turn_id": "turn_abc",
        "role_id": "dev",
        "limit_minutes": 30,
        "elapsed_minutes": 35,
        "exceeded_by_minutes": 5,
        "action": "warn"
      }
    ]
  },
  "live_context": {
    "awaiting_approval": false,
    "pending_gate_type": null,
    "requested_at": null
  },
  "events": [
    {
      "type": "timeout_warning",
      "scope": "turn",
      "phase": "planning",
      "turn_id": "turn_abc",
      "limit_minutes": 30,
      "elapsed_minutes": 35,
      "exceeded_by_minutes": 5,
      "action": "warn",
      "timestamp": "2026-04-11T01:00:00Z"
    }
  ]
}
```

- `configured`: whether `config.timeouts` exists.
- `config`: the raw timeouts config section (with per-phase routing overrides flattened).
- `live`: dashboard timeout pressure. Phase/run scopes are evaluated once per request. Turn scope is evaluated once per active turn, and turn-scoped rows must include `turn_id` and `role_id`.
- `live_context`: whether the run is currently paused on human approval and, if so, which gate type requested the approval plus `requested_at` when available.
- `events`: persisted timeout events from the decision ledger (same shape as `extractTimeoutEventDigest()`).

When no timeouts are configured: `{ ok: true, configured: false, config: null, live: null, events: [] }`.
When no run state exists: `{ ok: false, status: 404, code: "state_missing", error: "..." }`.

### Frontend View

Dashboard nav item: `Timeouts`

Dashboard component: `cli/dashboard/components/timeouts.js`

Render sections:
1. **Freshness banner** — websocket freshness via `liveMeta` (same contract as Timeline/Cross-Repo). Timeout data is time-sensitive — operators staring at the view need visibility into whether the displayed pressure values are current or stale.
2. **Header** — "Timeouts" with configured/not-configured badge.
3. **Config Summary** — table showing each scope, limit, and action.
4. **Live Pressure** — if the run is active, show exceeded (red) and warning (yellow) items with scope, turn identity when scope is `turn`, elapsed/limit, and action. If the run is paused on approval, still show phase/run live pressure plus a note that approval waits do not mutate timeout state but the clock continues.
5. **Persisted Events** — table of past timeout events from the ledger: type, scope, phase, turn_id, elapsed/limit, action, timestamp. Empty-state message when no events.

### Server Module

`cli/src/lib/dashboard/timeout-status.js` — single `readTimeoutStatus(workspacePath)` function following the same pattern as `readWorkflowKitArtifacts()`.

## Behavior

- Live evaluation runs against `new Date()` on every request — no caching.
- The dashboard must not silently drop per-turn timeout pressure. It evaluates phase/run once, then evaluates each active turn individually and annotates turn-scoped rows with `turn_id` and `role_id`.
- Approval-pending runs are not treated like generic inactive runs. They return read-only phase/run live pressure plus `live_context.awaiting_approval = true`; turn-scoped live pressure still remains active-run only.
- Per-phase routing overrides are flattened into `config` for display: `{ phase: "qa", limit_minutes: 60, action: "skip_phase" }`.
- Events are extracted from `.agentxchain/decision-ledger.jsonl` via `extractTimeoutEventDigest()`.
- When the run is not `active` and not paused on approval (completed, blocked, idle), live pressure returns empty arrays — historical events still render.

## Error Cases

- No `agentxchain.json` or no state: 404 with `code: "config_missing"` / `"state_missing"`.
- No `timeouts` configured: 200 with `configured: false`, null config/live, empty events.
- Ledger missing or empty: 200 with empty events array.

## Acceptance Tests

1. `readTimeoutStatus` returns `configured: false` when no timeouts in config.
2. `readTimeoutStatus` returns `configured: true` with config summary when timeouts exist.
3. `readTimeoutStatus` returns live phase/run exceeded-warnings for active runs.
4. `readTimeoutStatus` returns turn-scoped live pressure for every active turn and includes `turn_id` / `role_id`.
5. `readTimeoutStatus` returns persisted events from the decision ledger.
6. `readTimeoutStatus` returns empty live arrays when state is neither `active` nor paused on approval.
7. `readTimeoutStatus` flattens per-phase routing overrides into config display.
8. Frontend `render()` shows config table, live pressure indicators, turn ids for turn-scoped rows, and event rows.
9. Frontend `render()` shows placeholder when no timeouts configured.
10. Frontend `render()` highlights exceeded items in red, warnings in yellow.
11. Approval-pending runs return phase/run live pressure plus `live_context.awaiting_approval`, and the frontend renders the approval-wait note.
12. Dashboard nav includes the `Timeouts` link.
13. `app.js` VIEWS includes `timeouts` with correct fetch key and render function.
14. Bridge server routes `/api/timeouts` to `readTimeoutStatus()`.
15. `AT-TIMEOUT-DASH-FRESHNESS-001`: Timeouts view receives `liveMeta` from the live-observer and renders a freshness banner via `renderLiveStatus()`, matching Timeline/Cross-Repo parity.

## Open Questions

None. This follows the existing dashboard endpoint-plus-panel pattern.
