# Phase-Aware Regression Detection

## Purpose

Extend export-diff regression detection to detect **backward phase movement** using the project's actual workflow phase order, not just shallow null checks. Exports must carry the phase ordering metadata so the diff can determine directionality without access to the original config.

## Interface

### Export Changes

Both run and coordinator exports gain a new `summary.workflow_phase_order` field:

```json
{
  "summary": {
    "phase": "implementation",
    "workflow_phase_order": ["planning", "implementation", "qa"]
  }
}
```

- **Source**: `Object.keys(config.routing)` (declaration order = phase order)
- **Fallback**: `null` when no routing config exists (unphased projects)
- **Invariant**: the `phase` field value must appear in `workflow_phase_order` when both are present

### Regression Detection

New regression category: `phase`

| ID Pattern | Category | Severity | Trigger |
|---|---|---|---|
| `REG-PHASE-*` | `phase` | `warning` | Phase moves backward in workflow order |

### Detection Rules

1. **Both exports have `workflow_phase_order`**: use the right export's phase order as the canonical ordering. If `left.phase` appears at index `i` and `right.phase` appears at index `j`, and `j < i`, that is a backward phase regression.
2. **Phase disappears** (`non-null → null`): regression (warning). Phase information was lost.
3. **Phase appears** (`null → non-null`): NOT a regression. This is forward progress.
4. **No phase order available**: skip phase regression detection entirely. No guessing.
5. **Phase not found in order array**: skip (unknown phase, cannot determine direction).
6. **Coordinator-specific**: coordinator exports inherit the same phase regression logic. Additionally, child repo phase regressions surface via `repo_run_statuses` (already covered by `REG-REPO-STATUS-*`).

### No False Positives

- Same phase → not a regression
- Forward movement (lower index → higher index) → not a regression
- `null → non-null` → not a regression (was unphased, now has phase)
- Unknown phases (not in order array) → not a regression (cannot determine direction)

## Behavior

### Export Side (`export.js`)

- `buildRunExport()`: add `summary.workflow_phase_order` from `Object.keys(config.routing || {})`; `null` when routing is empty/absent
- `buildCoordinatorExport()`: add `summary.workflow_phase_order` from coordinator config routing

### Normalization Side (`export-diff.js`)

- `normalizeRunExport()`: extract `workflow_phase_order` as sorted string array (preserve order, don't sort alphabetically)
- `normalizeCoordinatorExport()`: same

### Detection Side (`export-diff.js`)

- `detectRunRegressions()`: add phase regression check after existing status regression
- `detectCoordinatorRegressions()`: inherits via `detectRunRegressions()` call

## Error Cases

- Missing `workflow_phase_order` on both sides → no phase regression emitted
- `workflow_phase_order` present on one side only → use available side for detection when possible; if only left has it, skip (right's phase context is unknown)
- Empty `workflow_phase_order` array → no phase regression emitted

## Acceptance Tests

| ID | Assertion |
|---|---|
| AT-PHASE-001 | Phase backward movement (implementation → planning) produces `REG-PHASE-*` warning |
| AT-PHASE-002 | Phase forward movement (planning → implementation) produces NO regression |
| AT-PHASE-003 | Same phase produces NO regression |
| AT-PHASE-004 | Phase disappears (non-null → null) produces `REG-PHASE-*` warning |
| AT-PHASE-005 | Phase appears (null → non-null) produces NO regression |
| AT-PHASE-006 | No `workflow_phase_order` on either export → no phase regression |
| AT-PHASE-007 | Custom phase order (design → build → verify → release) backward produces regression |
| AT-PHASE-008 | Coordinator phase backward movement produces regression |
| AT-PHASE-009 | CLI text output includes phase regression in Governance Regressions section |
| AT-PHASE-010 | CLI JSON output includes phase regression with correct category/severity |

## Open Questions

None. The design is narrow and self-contained.
