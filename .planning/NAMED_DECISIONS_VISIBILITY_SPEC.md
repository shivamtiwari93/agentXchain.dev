# Named Decisions Visibility — Report + Dashboard

## Purpose

Surface `named_decisions` barrier detail (required decision IDs per repo, satisfied/pending per repo) in the operator-facing governance report and dashboard initiative view. Currently both surfaces show barrier type, status, and repo counts but hide *which* specific decisions are required and which repos have satisfied them.

## Scope

Three additive changes:

1. **`extractBarrierSummary()` in `report.js`** — include `required_decision_ids_by_repo` and `satisfied_decision_ids_by_repo` fields when the barrier type is `named_decisions` or `interface_alignment`.
2. **Report text/markdown rendering** — when a barrier has decision-ID requirements, render a per-repo breakdown showing required IDs and their satisfaction status.
3. **Dashboard `initiative.js`** — when a barrier card has `required_decision_ids_by_repo`, render the per-repo decision-ID detail with visual satisfied/pending indicators.

## Interface

### Report JSON (additive fields on barrier_summary entries)

```json
{
  "barrier_id": "barrier-ws-001",
  "type": "named_decisions",
  "status": "partially_satisfied",
  "required_decision_ids_by_repo": {
    "api": ["DEC-101"],
    "web": ["DEC-201", "DEC-202"]
  },
  "satisfied_decision_ids_by_repo": {
    "api": ["DEC-101"],
    "web": []
  }
}
```

### Report text format (additive)

```
Barrier Summary:
  - barrier-ws-001: partially_satisfied (named_decisions, 1/2 repos satisfied, workstream ws-001)
    Decision requirements:
      api: DEC-101 (satisfied)
      web: DEC-201 (pending), DEC-202 (pending)
```

### Report markdown format (additive)

After the existing barrier summary table, a new subsection per barrier with decision detail:

```markdown
**barrier-ws-001** decision requirements:

| Repo | Required | Satisfied |
|------|----------|-----------|
| `api` | `DEC-101` | `DEC-101` |
| `web` | `DEC-201`, `DEC-202` | — |
```

### Dashboard initiative view (additive)

Inside each barrier card, when `required_decision_ids_by_repo` exists:

```html
<div class="turn-detail">
  <span class="detail-label">Decision Requirements:</span>
</div>
<div class="decision-req-list">
  <div>api: <span class="badge satisfied">DEC-101 ✓</span></div>
  <div>web: <span class="badge pending">DEC-201</span> <span class="badge pending">DEC-202</span></div>
</div>
```

## Behavior

- Fields are **additive**. Barriers without decision-ID requirements render exactly as before.
- `satisfied_decision_ids_by_repo` is derived by cross-referencing `required_decision_ids_by_repo` with `satisfied_repos` from the barrier snapshot. If a repo appears in `satisfied_repos`, all its required decision IDs are satisfied.
- The dashboard reads `required_decision_ids_by_repo` directly from the `/api/coordinator/barriers` payload (the coordinator state already exposes this field).

## Error Cases

- `required_decision_ids_by_repo` is null/undefined → skip decision detail rendering (barrier renders as before)
- Empty decision array for a repo → skip that repo in detail rendering
- Barrier type is not `named_decisions` or `interface_alignment` → skip decision detail

## Acceptance Tests

- AT-NDVIS-001: Report JSON barrier entry includes `required_decision_ids_by_repo` and `satisfied_decision_ids_by_repo` for named_decisions barrier
- AT-NDVIS-002: Report text output renders per-repo decision breakdown with satisfied/pending labels
- AT-NDVIS-003: Report markdown output renders decision-requirements table
- AT-NDVIS-004: Dashboard initiative barrier card renders decision-ID detail for named_decisions barrier
- AT-NDVIS-005: Barriers without decision requirements render unchanged (no regression)
- AT-NDVIS-006: Docs page documents the new fields

## Open Questions

None — this is a pure additive visibility slice.
