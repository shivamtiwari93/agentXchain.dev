# Timeout Dashboard Surface Spec

## Purpose

Add timeout visibility to the governed dashboard as an 11th view ("Timeouts"). Operators can observe live timeout pressure on active runs, review persisted timeout events from the decision ledger, and understand recovery actions — all without leaving the dashboard.

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
        "scope": "phase",
        "phase": "implementation",
        "limit_minutes": 120,
        "elapsed_minutes": 95,
        "exceeded_by_minutes": 0,
        "action": "escalate"
      }
    ]
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
- `live`: result of `evaluateTimeouts()` against current time and state. Empty arrays when run is not `active`.
- `events`: persisted timeout events from the decision ledger (same shape as `extractTimeoutEventDigest()`).

When no timeouts are configured: `{ ok: true, configured: false, config: null, live: null, events: [] }`.
When no run state exists: `{ ok: false, status: 404, code: "state_missing", error: "..." }`.

### Frontend View

11th nav item: `<a href="#timeouts">Timeouts</a>` — placed after "Run History".

Dashboard component: `cli/dashboard/components/timeouts.js`

Render sections:
1. **Header** — "Timeouts" with configured/not-configured badge.
2. **Config Summary** — table showing each scope, limit, and action.
3. **Live Pressure** — if the run is active, show exceeded (red) and warning (yellow) items with scope, elapsed/limit, and action. Empty-state message when nothing exceeded.
4. **Persisted Events** — table of past timeout events from the ledger: type, scope, phase, turn_id, elapsed/limit, action, timestamp. Empty-state message when no events.

### Server Module

`cli/src/lib/dashboard/timeout-status.js` — single `readTimeoutStatus(workspacePath)` function following the same pattern as `readWorkflowKitArtifacts()`.

## Behavior

- Live evaluation runs `evaluateTimeouts()` against `new Date()` on every request — no caching.
- Per-phase routing overrides are flattened into `config` for display: `{ phase: "qa", limit_minutes: 60, action: "skip_phase" }`.
- Events are extracted from `.agentxchain/decision-ledger.jsonl` via `extractTimeoutEventDigest()`.
- When the run is not `active` (completed, blocked), live pressure returns empty arrays — historical events still render.

## Error Cases

- No `agentxchain.json` or no state: 404 with `code: "config_missing"` / `"state_missing"`.
- No `timeouts` configured: 200 with `configured: false`, null config/live, empty events.
- Ledger missing or empty: 200 with empty events array.

## Acceptance Tests

1. `readTimeoutStatus` returns `configured: false` when no timeouts in config.
2. `readTimeoutStatus` returns `configured: true` with config summary when timeouts exist.
3. `readTimeoutStatus` returns live exceeded/warnings from `evaluateTimeouts()`.
4. `readTimeoutStatus` returns persisted events from the decision ledger.
5. `readTimeoutStatus` returns empty live arrays when state is not `active`.
6. `readTimeoutStatus` flattens per-phase routing overrides into config display.
7. Frontend `render()` shows config table, live pressure indicators, and event rows.
8. Frontend `render()` shows placeholder when no timeouts configured.
9. Frontend `render()` highlights exceeded items in red, warnings in yellow.
10. Dashboard nav includes "Timeouts" link.
11. `app.js` VIEWS includes `timeouts` with correct fetch key and render function.
12. Bridge server routes `/api/timeouts` to `readTimeoutStatus()`.

## Open Questions

None. Pattern is established by 10 existing views.
