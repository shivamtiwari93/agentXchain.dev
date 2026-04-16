# Coordinator Attention Summary Presentation Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one shared presentation contract for coordinator attention summary wording and pending-gate detail rows so the Initiative, Blockers, and Blocked views do not privately invent titles, subtitles, detail labels, or approval-summary copy for the same coordinator state.

## Interface

- Shared helper file: `cli/src/lib/coordinator-blocker-presentation.js`
- Shared helper exports:
  - `buildCoordinatorAttentionSnapshotPresentation(coordinatorBlockers)`
  - `getCoordinatorAttentionStatusCard(coordinatorBlockers)`
- Dashboard consumers:
  - `cli/dashboard/components/initiative.js`
  - `cli/dashboard/components/blockers.js`
  - `cli/dashboard/components/blocked.js`

## Behavior

1. Canonical snapshot presentation
   - Initiative coordinator attention snapshots must use one helper-backed contract.
   - Snapshot detail rows use canonical labels.
   - Non-pending coordinator attention snapshots use:
     - `Mode`
     - `Type`
     - `Gate`
     - `Current Phase`
     - `Target Phase`
     - `Blockers`
     - `Primary Blocker`
   - Pending-gate snapshots use:
     - `Mode`
     - `Type`
     - `Gate`
     - `Current Phase`
     - `Target Phase`
     - `Required Repos`
     - `Approval State`
     - `Human Barriers` when present
   - The shared snapshot subtitle is:
     - `First-glance coordinator attention only. Full blocker diagnostics stay in the Blockers view.`
   - Initiative must not render a second private `Pending Gate` card when the shared `Approval Snapshot` is present.
2. Canonical approval summary wording
   - When the coordinator is in `pending_gate` mode with no remaining blockers, the shared status summary is:
     - title: `Approval Snapshot`
     - message: `All coordinator prerequisites are satisfied. Human approval is the remaining action.`
3. Canonical no-blocker summary wording
   - When a non-pending coordinator gate has no blockers, the shared status summary is:
     - title: `Gate Clear`
     - message: `The coordinator gate has no outstanding blockers.`
4. Renderer boundary
   - Initiative and Blockers may add view-specific surrounding layout, but they must not hardcode coordinator attention summary titles or approval/no-blocker status copy inline.
   - Blocked may render a distinct `Pending Gate` diagnostics section, but it must source its coordinator gate rows from `getCoordinatorPendingGateDetails(...)`.
   - Blocked must not privately reduce coordinator pending-gate diagnostics to a local `Gate`/`Type` pair when the shared helper exposes the fuller contract.

## Error Cases

- Missing or malformed blocker snapshots return `null` from the shared presentation helpers.
- `no_next_phase` remains filtered out of coordinator attention summaries and must not appear as the primary blocker.
- If no blocker details exist, renderers must omit the detail rows instead of fabricating fallback labels.

## Acceptance Tests

- `AT-CBPS-004`: shared snapshot presentation emits canonical detail rows and shared subtitle.
- `AT-CBPS-005`: shared status-card helper emits canonical pending-approval and no-blocker summaries.
- `AT-CBPS-006`: Initiative and Blockers import shared summary helpers and no longer hardcode the legacy snapshot/status strings inline.
- `AT-CBPS-007`: shared snapshot presentation absorbs pending-gate detail rows so Initiative does not render a second `Pending Gate` card.
- `AT-CBPS-008`: Blocked imports the shared pending-gate detail helper and renders canonical coordinator pending-gate rows instead of hardcoding local `gate` / `gate_type` fields.

## Open Questions

- None for this slice.
