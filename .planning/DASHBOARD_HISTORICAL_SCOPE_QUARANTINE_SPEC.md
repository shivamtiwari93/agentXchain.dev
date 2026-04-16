# Dashboard Historical Scope Quarantine Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-16

## Purpose

Older v2/v2.1 planning specs still matter because the repo, tests, and collaboration log cite them as historical product evidence. That does not give them permission to contradict the shipped live dashboard.

This spec freezes the quarantine rule:

- historical scope/spec docs may preserve the original read-only v2/v2.1 dashboard boundary
- those same docs must say explicitly that the mutability claim is historical
- they must point readers at the current shipped authority for live dashboard mutability

Without that quarantine, the repo tells two incompatible stories at once: "dashboard remains read-only" and "live dashboard supports authenticated approve-gate."

## Interface

### Historical files that must be quarantined

- `.planning/V2_SCOPE_BOUNDARY.md`
- `.planning/V2_DASHBOARD_SPEC.md`
- `.planning/V2_1_SCOPE_BOUNDARY.md`
- `.planning/V2_1_DASHBOARD_DRILLDOWN_SPEC.md`
- `.planning/DASHBOARD_IMPLEMENTATION_PLAN.md`

### Current authority files they must reference

- `.planning/DASHBOARD_GATE_ACTIONS_SPEC.md`
- `.planning/DASHBOARD_DOCS_CONTRACT_SPEC.md`

### Guard

- `cli/test/dashboard-historical-scope-content.test.js`

## Behavior

1. Each historical file must identify itself as historical, superseded, or otherwise not the current dashboard-mutability authority.
2. Each historical file must point to the current shipped mutability authority:
   - live local dashboard supports authenticated `approve-gate`
   - WebSocket remains read-only
   - `replay export` remains the read-only artifact-backed dashboard
3. Historical files may keep original v2/v2.1 wording such as "dashboard remains read-only," but only when the surrounding text makes the time boundary explicit.
4. The quarantine must not erase the original release-boundary meaning of the files.
5. Historical implementation plans may keep obsolete slice structure and old constraints, but only when they label that scope as historical and point to the current mutability authority.

## Error Cases

1. A historical file still says "dashboard remains read-only" with no superseding note: fail the guard.
2. A historical file points only to replay/read-only behavior and omits the live `approve-gate` path: fail the guard.
3. A historical file implies WebSocket became writable: fail the guard.
4. A historical file erases its original v2/v2.1 boundary instead of labeling it as historical: fail the guard.
5. A non-quarantined implementation plan still teaches "read-only dashboard" as current product truth: fail the guard.

## Acceptance Tests

1. `AT-DASH-HIST-001`: `V2_SCOPE_BOUNDARY.md` marks the dashboard mutability claim as historical and points to the current live-dashboard authority.
2. `AT-DASH-HIST-002`: `V2_DASHBOARD_SPEC.md` keeps its original v2.0 read-only boundary but labels it as historical and references the superseding live-vs-replay contract.
3. `AT-DASH-HIST-003`: `V2_1_SCOPE_BOUNDARY.md` marks v2.1 read-only language as historical and does not keep "dashboard write actions" deferred as if no write path ever shipped.
4. `AT-DASH-HIST-004`: `V2_1_DASHBOARD_DRILLDOWN_SPEC.md` labels its read-only assumption as historical and points to the current live-dashboard authority.
5. `AT-DASH-HIST-005`: `DASHBOARD_IMPLEMENTATION_PLAN.md` is explicitly quarantined as a historical v2.0 implementation plan and does not teach its read-only baseline as current dashboard truth.

## Open Questions

1. Should the repo eventually move historical release-boundary specs into a dedicated `historical/` subtree, or is explicit quarantine in-place sufficient?
