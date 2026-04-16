# Coordinator Pending Gate Presentation Spec

## Purpose

Freeze one shared presentation contract for coordinator pending-gate identity across dashboard surfaces.

The same coordinator gate currently appears in the Gate view, Initiative view, and Blockers view. Those surfaces must not privately remap gate identity, phase labels, repo requirements, or approval-state wording.

## Interface

File: `cli/src/lib/coordinator-pending-gate-presentation.js`

Exports:

- `getCoordinatorPendingGateSnapshot({ pendingGate, active })`
- `getCoordinatorPendingGateDetails({ pendingGate, active, includeType, includeApprovalState, includeHumanBarriers })`

## Behavior

- The helper accepts either:
  - `pendingGate` from coordinator state, or
  - `active` from `/api/coordinator/blockers`, or
  - both
- The helper normalizes the following fields into one snapshot:
  - gate type
  - gate id
  - current phase
  - target phase
  - required repos
  - human barriers
  - pending approval state
- `getCoordinatorPendingGateDetails(...)` returns ordered detail rows using canonical labels:
  - `Type`
  - `Gate`
  - `Current Phase`
  - `Target Phase`
  - `Required Repos`
  - `Approval State`
  - `Human Barriers`
- `Approval State` must render as `Awaiting human approval` for coordinator pending gates.
- Renderers may append view-specific detail after the shared rows, but they must not restate the normalized fields by hand.

## Error Cases

- Missing or malformed input returns `null` from snapshot and `[]` from details.
- Empty arrays or empty strings are omitted from rendered detail rows.
- A run-completion pending gate may omit phase rows without being treated as invalid.

## Acceptance Tests

- `AT-CPGP-001`: helper normalizes pending-gate state and blocker snapshots into one canonical detail list.
- `AT-CPGP-002`: Gate, Initiative, and Blockers renderers import the helper instead of directly reading raw pending-gate identity fields.
- `AT-IVH-005`: Initiative uses shared pending-gate labels including `Current Phase`, `Target Phase`, and `Approval State`.
- `AT-DV-GATE-001`: Gate view uses shared coordinator pending-gate detail rows.
- `AT-DB-008`: Blockers pending-gate mode renders the shared approval-state wording.

## Open Questions

- None for this slice. The contract is presentation-only and should stay narrow.
