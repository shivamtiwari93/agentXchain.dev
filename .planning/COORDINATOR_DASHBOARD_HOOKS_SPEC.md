# Coordinator Dashboard Hooks View — Spec

## Purpose

Make the shared dashboard **Hooks** view truthful in coordinator workspaces by fetching and rendering coordinator-level hook audit and annotation data from `/api/coordinator/hooks/audit` and `/api/coordinator/hooks/annotations`, alongside repo-local hook data.

## Problem

The Hooks view only fetches repo-local hook data (`/api/hooks/audit`, `/api/hooks/annotations`). In coordinator workspaces, coordinator hooks fire during `before_assignment`, `after_acceptance`, `before_gate`, and `on_escalation` phases and write audit/annotation data to `.agentxchain/multirepo/hook-audit.jsonl` and `.agentxchain/multirepo/hook-annotations.jsonl`. The bridge already exposes these files via `/api/coordinator/hooks/audit` and `/api/coordinator/hooks/annotations` (defined in `state-reader.js`). But the SPA never fetches them, so the Hooks view shows a false empty state for coordinator hook activity.

This is the same pattern as the Decisions view gap fixed in `DEC-DASHBOARD-COORD-LEDGER-001`.

## Interface

No new commands or API endpoints. The fix is purely SPA-side:

1. `app.js` — add `coordinatorAnnotations` to `API_MAP`, add `coordinatorAudit` and `coordinatorAnnotations` to hooks fetch list
2. `hooks.js` — accept `coordinatorAudit` and `coordinatorAnnotations` props, render separate sections when coordinator data exists

## Behavior

- When only repo-local data exists: render exactly as before (single "Hook Audit Log" / "Hook Annotations" sections)
- When only coordinator data exists: render "Coordinator Hook Audit Log" / "Coordinator Hook Annotations" sections
- When both exist: render separate sections with prefixed titles ("Repo Hook Audit Log" / "Coordinator Hook Audit Log"), shared filter bar covering both sources
- Filters (phase, verdict, hook name) apply independently to each section's data
- Empty coordinator data (null or []) does not create empty sections

## Error Cases

- Missing coordinator endpoint (404): `fetchData` returns null, treated as empty — no coordinator sections rendered
- Malformed coordinator JSONL: bridge returns 500, treated as null — same fallback

## Acceptance Tests

1. Hooks view renders repo-local data unchanged when no coordinator data exists
2. Hooks view renders "Coordinator Hook Audit Log" section when coordinator audit data exists
3. Hooks view renders "Coordinator Hook Annotations" section when coordinator annotation data exists
4. Hooks view renders separate "Repo" and "Coordinator" section titles when both sources have data
5. Hooks view filter bar includes phases and hook names from both repo-local and coordinator sources
6. Empty coordinator data does not produce empty sections
7. CLI docs describe coordinator hooks in the dashboard Hooks view

## Open Questions

None — this follows the established dual-source pattern from the Decisions view.
