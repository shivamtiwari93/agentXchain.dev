# Spec: Doctor Dashboard Daemon Visibility

## Purpose

`agentxchain doctor` must report the dashboard daemon's actual status so operators know whether the dashboard is live, stale, or not running — without guessing from stray files.

## Interface

New check in the governed doctor output: `dashboard_session`.

This check appears **unconditionally** in governed mode (unlike schedule_health which is gated on configured schedules). The dashboard is a general operator surface, not a config-gated feature.

### Check logic

1. Read `.agentxchain-dashboard.pid` via `getDashboardPid(root)`.
2. Read `.agentxchain-dashboard.json` via `getDashboardSession(root)`.
3. Evaluate:

| PID alive? | Session file? | Level  | Detail                                              |
|------------|---------------|--------|-----------------------------------------------------|
| yes        | valid         | `pass` | `Dashboard running at {url} (PID: {pid})`           |
| yes        | missing/bad   | `warn` | `Dashboard PID {pid} alive but session file missing` |
| no         | exists        | `warn` | `Stale dashboard session files (PID {pid} not running)` |
| no         | missing       | `info` | `No dashboard session`                               |

4. When stale files are detected (PID dead + session file present), `doctor` reports the warning but does **not** auto-clean. Cleanup is `agentxchain stop`'s job. Doctor is read-only.

### JSON output

Add to the `checks` array with `id: 'dashboard_session'`.

### `status --json` extension

Add a `dashboard_session` key to the governed `status --json` output:

```json
{
  "dashboard_session": {
    "status": "running" | "stale" | "not_running",
    "pid": 12345 | null,
    "url": "http://localhost:3847" | null,
    "started_at": "2026-04-14T..." | null
  }
}
```

When no session files exist: `{ "status": "not_running", "pid": null, "url": null, "started_at": null }`.

## Error Cases

- PID file contains non-numeric garbage → treat as no PID (getDashboardPid already handles this).
- Session file is corrupt JSON → treat as no session (getDashboardSession already handles this).
- Doctor must never throw on dashboard check failure. Catch and report.

## Acceptance Tests

- **AT-DOCTOR-DASH-001**: Governed project with no dashboard files → check level `info`, detail contains "No dashboard session".
- **AT-DOCTOR-DASH-002**: Governed project with live PID + valid session → check level `pass`, detail contains URL and PID.
- **AT-DOCTOR-DASH-003**: Governed project with dead PID + session file → check level `warn`, detail contains "Stale".
- **AT-DOCTOR-DASH-004**: JSON output includes `dashboard_session` check in `checks` array.
- **AT-DOCTOR-DASH-005**: `status --json` includes `dashboard_session` object with correct shape.

## Open Questions

None. All primitives (`getDashboardPid`, `getDashboardSession`) already exist and are tested.
