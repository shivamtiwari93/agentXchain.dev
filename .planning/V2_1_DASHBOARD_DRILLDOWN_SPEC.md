# V2.1-F3: Dashboard Evidence Drill-Down — Spec

> Shipped: 2026-04-03
>
> Historical slice note: this file preserves the v2.1 evidence-drilldown contract. It is not the current authority for live dashboard mutability. The current shipped mutability contract lives in `.planning/DASHBOARD_GATE_ACTIONS_SPEC.md` and `.planning/DASHBOARD_DOCS_CONTRACT_SPEC.md`: the live local dashboard supports authenticated `approve-gate` HTTP mutations, the WebSocket channel remains read-only, and `replay export` remains read-only.

---

## Purpose

Operators reviewing governed runs should not have to drop into raw JSONL ledgers during gate decisions. V2.1-F3 adds evidence depth to three dashboard views: timeline turn detail panels, decision ledger filters, and hook audit filters.

## Interface

### Timeline Turn Detail Panels
- Each turn card is expandable (click to toggle)
- Expanded panel shows hook annotations and audit entries filtered to that turn's `turn_id`
- Backwards compatible: works if annotations/audit data is missing

### Decision Ledger Filters
- **Phase** dropdown — extracts unique phases from entries
- **Date range** — from/to date inputs filtering by `entry.timestamp`
- **Objection badge** — visible indicator on entries with non-empty `objections` arrays
- **Timestamp column** added to the table

### Hook Audit Log Filters
- **Phase** dropdown
- **Verdict** dropdown (all/allow/warn/block)
- **Hook name** dropdown
- Filtered count shown ("N of M hook executions")

## Behavior

1. All filtering is client-side on already-fetched data
2. Filters compose conjunctively (all active filters must match)
3. Empty/null filter values match everything
4. Historical v2.1 boundary only: this drill-down slice assumed the dashboard remained read-only. Later releases superseded that for the live dashboard with a narrow authenticated `approve-gate` action; replay/export remained read-only.
5. Filter state lives in `viewState` in app.js (not persisted across page loads)

## Error Cases

1. Missing or null annotation/audit data: panels show "No hook evidence for this turn"
2. Entries without timestamps: excluded from date range filter (returned by default)
3. Entries without phase: excluded from phase filter matches but shown when filter is "all"

## Acceptance Tests

- `AT-V21-007`: Turn detail renders hook annotations and audit context for a turn (7 sub-tests)
- `AT-V21-008`: Decision and hook-audit views honor phase/verdict/date filters (21 sub-tests)

## Decisions

- `DEC-V21-DASH-001`: Dashboard V2.1-F3 shipped turn detail panels, ledger filters, and hook audit filters under the original v2.1 read-only boundary. The current live-dashboard mutation contract is narrower and newer: authenticated `approve-gate` only, with replay/export still read-only.
- `DEC-V21-DASH-002`: Filter functions are exported for unit testing (`filterEntries`, `filterAudit`).
