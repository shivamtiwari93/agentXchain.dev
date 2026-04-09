# Workflow-Kit Dashboard Observation Spec

## Purpose

Expose workflow-kit artifact status as a live dashboard surface so operators can observe current-phase artifact state without requiring an export→report round trip.

## Interface

### API Endpoint

`GET /api/workflow-kit-artifacts` — computed endpoint (like `/api/coordinator/blockers`), not a static file read.

**Response shape:**

```json
{
  "ok": true,
  "phase": "planning",
  "artifacts": [
    {
      "path": ".planning/SYSTEM_SPEC.md",
      "required": true,
      "semantics": "system_spec",
      "owned_by": "pm",
      "owner_resolution": "explicit",
      "exists": true
    }
  ]
}
```

**Error responses:**

- `404` with `{ ok: false, code: "config_missing" }` when `agentxchain.json` not found
- `404` with `{ ok: false, code: "state_missing" }` when `.agentxchain/state.json` not found
- `200` with `{ ok: true, phase: "...", artifacts: null }` when no workflow_kit configured
- `200` with `{ ok: true, phase: "...", artifacts: [] }` when phase has no artifacts

### Dashboard Panel

9th view: `#artifacts` — "Artifacts" nav tab.

Renders:
- Phase indicator
- Table: Path | Required | Semantics | Owner | Resolution | Status
- Status column: green checkmark for exists, red X for missing
- Missing required artifacts highlighted
- Placeholder when no workflow_kit configured or no run active

### Data Flow

1. Bridge server reads `agentxchain.json` (config) and `.agentxchain/state.json` (state) on each request
2. Resolves current phase from state
3. Reads `config.workflow_kit.phases[phase].artifacts`
4. Resolves ownership: explicit `owned_by` → `"explicit"`, fallback to `routing[phase].entry_role` → `"entry_role"`
5. Checks file existence against workspace filesystem (live, not export)
6. Returns sorted array

### File Watcher

The endpoint re-reads on every request (consistent with existing dashboard pattern). WebSocket invalidation for `.agentxchain/state.json` changes already triggers client refresh via the existing watcher, which covers phase transitions and state changes.

For config changes: `agentxchain.json` is not currently watched. The dashboard will pick up config changes on next manual refresh or state change. This is acceptable because config changes are rare and always accompanied by a governed state change.

## Behavior

1. Artifacts are sorted by path (locale-aware, English).
2. File existence is checked against the live workspace filesystem using `existsSync()`.
3. The `owned_by` resolution logic matches `extractWorkflowKitArtifacts()` from `report.js` exactly.
4. When `workflow_kit` is absent from config, `artifacts` is `null`.
5. When the current phase has no artifacts entry, `artifacts` is `[]`.
6. The panel omits the table and shows a message when `artifacts` is `null` or empty.
7. Missing required artifacts use a visually distinct treatment (red border or highlight).

## Error Cases

1. No `agentxchain.json` → 404 with guidance to run `agentxchain init --governed`
2. No `.agentxchain/state.json` → 404 with guidance to run `agentxchain init --governed`
3. Config valid but no `workflow_kit` section → 200 with `artifacts: null`
4. Phase not found in `workflow_kit.phases` → 200 with `artifacts: []`

## Acceptance Tests

- **AT-WKDASH-001**: Panel renders artifact table with correct columns when workflow_kit configured
- **AT-WKDASH-002**: Exists/missing status renders with correct visual indicators
- **AT-WKDASH-003**: Missing required artifact gets highlighted treatment
- **AT-WKDASH-004**: Placeholder rendered when no workflow_kit configured (artifacts null)
- **AT-WKDASH-005**: Placeholder rendered when no run active (state null)
- **AT-WKDASH-006**: Owner resolution shows explicit vs entry_role distinction
- **AT-WKDASH-007**: Phase indicator shows current phase
- **AT-WKDASH-008**: API endpoint returns correct shape with all fields
- **AT-WKDASH-009**: API endpoint returns 404 when config missing
- **AT-WKDASH-010**: Dashboard nav includes Artifacts tab (9 views total)
- **AT-WKDASH-011**: Artifacts sorted by path

## Open Questions

None.
