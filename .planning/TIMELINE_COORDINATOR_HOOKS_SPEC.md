# Timeline Coordinator Hook Evidence — Spec

## Purpose

The dashboard Timeline view's turn-detail panel must render coordinator hook audit and annotation data in coordinator workspaces, matching the parity pattern already established by the Hooks view (`DEC-DASHBOARD-COORD-HOOKS-001`) and Decisions view (`DEC-DASHBOARD-COORD-LEDGER-001`).

## Problem

- `app.js` Timeline fetch list omits `coordinatorAudit` and `coordinatorAnnotations`
- `timeline.js` `render()` does not accept coordinator props
- `renderTurnDetailPanel()` only filters repo-local `audit`/`annotations` by `turn_id`
- Result: coordinator hook evidence is invisible in Timeline turn detail panels

## Solution

1. Add `coordinatorAudit` and `coordinatorAnnotations` to the Timeline fetch list in `app.js`
2. Accept `coordinatorAudit` and `coordinatorAnnotations` as optional props in `render()`
3. Pass both coordinator sources through to `renderTurnDetailPanel()`
4. When both repo-local and coordinator data exist for a turn, render separate titled sections ("Repo Hook Audit" / "Coordinator Hook Audit") — same pattern as the Hooks view
5. When only one source exists, render without prefix labels — no visual change for repo-only workspaces

## Acceptance Tests

- AT-TCH-001: Timeline with coordinator audit renders "Coordinator Hook Audit" section
- AT-TCH-002: Timeline with coordinator annotations renders "Coordinator Annotations" section
- AT-TCH-003: Timeline with both repo and coordinator audit renders separate "Repo Hook Audit" / "Coordinator Hook Audit" sections
- AT-TCH-004: Timeline with only repo-local data renders without coordinator sections (backward compatible)
- AT-TCH-005: Timeline with null coordinator data renders identically to pre-change behavior
- AT-TCH-006: CLI docs describe coordinator hook evidence in Timeline view

## Non-Goals

- No changes to the blocked view's annotation behavior (per `DEC-DASHBOARD-COORD-HOOKS-004`)
- No new dashboard navigation tabs
- No new API endpoints
