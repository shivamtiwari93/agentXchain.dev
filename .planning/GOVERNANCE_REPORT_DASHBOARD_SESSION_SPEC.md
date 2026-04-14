# Governance Report Dashboard Session Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-14

## Purpose

Expose dashboard-daemon snapshot truth in `agentxchain export` and `agentxchain report` so verified audit artifacts carry the same operator signal that `doctor` and `status --json` now expose locally.

Without this slice, dashboard daemon state exists only as live-repo inspection output. Export artifacts and governance reports drop that context, which makes the audit surface weaker than the local operator surface.

## Interface

No new CLI flags.

Additive run-export field:

- `summary.dashboard_session`

Additive governed-run report field:

- `subject.run.dashboard_session`

Human-readable report output adds a single summary line when the field is present:

- `Dashboard session: ...` in `text`
- `- Dashboard session: ...` in `markdown`

## Behavior

### Export

- Run exports include `.agentxchain-dashboard.pid` and `.agentxchain-dashboard.json` when present.
- Run exports derive `summary.dashboard_session` from the source checkout at export time using the same four-state logic already used by the governed doctor/status surfaces:
  - `running`
  - `pid_only`
  - `stale`
  - `not_running`
- The object shape is:

```json
{
  "status": "running" | "pid_only" | "stale" | "not_running",
  "pid": 12345 | null,
  "url": "http://localhost:3847" | null,
  "started_at": "2026-04-14T..." | null
}
```

### Report

- Governed-run reports expose `subject.run.dashboard_session` when the verified export summary field is well-formed.
- Older artifacts that predate `summary.dashboard_session` must still verify and report successfully; in that case `subject.run.dashboard_session` is `null`.
- Human-readable text and markdown output render the snapshot summary line only when `subject.run.dashboard_session` is non-null.
- The summary line must distinguish:
  - running dashboard with URL and PID
  - pid-only warning state
  - stale session files
  - explicit not-running snapshot

## Error Cases

- Exported summary omits `dashboard_session` because the artifact predates this field
- Exported `dashboard_session` shape is malformed
- PID file contains invalid content
- Session file contains corrupt JSON

## Acceptance Tests

- `AT-EXPORT-DASH-001`: run export with no dashboard session files emits `summary.dashboard_session.status === "not_running"`.
- `AT-EXPORT-DASH-002`: run export with live PID + session emits `summary.dashboard_session.status === "running"` and captures URL/PID.
- `AT-REPORT-DASH-001`: governed-run report JSON exposes `subject.run.dashboard_session` from a verified export artifact.
- `AT-REPORT-DASH-002`: text and markdown report output render the dashboard session summary line for running snapshots.
- `AT-REPORT-DASH-003`: older artifacts without `summary.dashboard_session` still report successfully and surface `subject.run.dashboard_session === null`.

## Open Questions

- Whether coordinator exports/reports should later aggregate child-repo dashboard snapshots, or keep dashboard session strictly repo-local.
