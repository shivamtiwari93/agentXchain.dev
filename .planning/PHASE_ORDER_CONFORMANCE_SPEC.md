# Phase Order Conformance And Drift Detection

## Purpose

Tighten the phase-aware export diff contract so it does not produce false confidence from malformed or drifting `workflow_phase_order` metadata.

This slice adds two guarantees:

1. `verify export` must reject exports whose `summary.workflow_phase_order` is malformed or inconsistent with `summary.phase`.
2. `diff --export` / `verify diff` must surface **phase-order drift** explicitly when left and right exports declare different workflow phase orders, instead of silently treating the right export as canonical truth.

## Interface

### Export Verification

Run and coordinator exports may include `summary.workflow_phase_order`.

When present, it must be:

- an array of non-empty trimmed strings
- free of duplicates
- non-empty
- consistent with `summary.phase`
  - if `summary.phase` is non-null, it must appear in `summary.workflow_phase_order`

### Export Diff Regression Detection

New regression pattern:

| ID Pattern | Category | Severity | Trigger |
|---|---|---|---|
| `REG-PHASE-ORDER-*` | `phase` | `warning` | Left and right exports declare different `workflow_phase_order` arrays |

### Directional Phase Comparison Rule

Backward phase movement detection is allowed only when:

- both exports have non-null `phase`
- both exports have `workflow_phase_order`
- the two `workflow_phase_order` arrays are exactly equal
- both phases appear in that shared order

If the phase-order arrays differ, directional phase comparison must be skipped and the diff must emit `REG-PHASE-ORDER-*`.

## Behavior

### `export-verifier.js`

- Validate `summary.workflow_phase_order` for both run and coordinator exports.
- Reject empty arrays, blank entries, non-string entries, duplicate entries, and phase/order mismatch.

### `export-diff.js`

- Detect phase-order drift when left and right arrays both exist and are not deeply equal.
- Emit one `REG-PHASE-ORDER-*` warning describing the drift.
- Suppress backward-phase inference when phase-order drift exists.
- Continue existing behavior for:
  - `phase -> null` information loss
  - equal phase orders with known backward movement
  - missing phase order on one or both sides (no directional inference)

## Error Cases

- `summary.workflow_phase_order: []` → verification failure
- `summary.workflow_phase_order: ["planning", "planning"]` → verification failure
- `summary.phase: "qa"` with `workflow_phase_order: ["planning", "implementation"]` → verification failure
- left/right phase-order arrays differ → diff warning, no directional phase movement guess

## Acceptance Tests

| ID | Assertion |
|---|---|
| AT-PHASE-CONF-001 | `verify export` rejects empty `summary.workflow_phase_order` |
| AT-PHASE-CONF-002 | `verify export` rejects duplicate phase names in `summary.workflow_phase_order` |
| AT-PHASE-CONF-003 | `verify export` rejects `summary.phase` missing from `summary.workflow_phase_order` |
| AT-PHASE-CONF-004 | `diff --export` emits `REG-PHASE-ORDER-*` when left/right phase orders differ |
| AT-PHASE-CONF-005 | `diff --export` does not emit backward-phase movement when phase orders differ |
| AT-PHASE-CONF-006 | equal phase orders still allow backward-phase regression detection |

## Open Questions

None. This is a fail-closed contract hardening slice, not a policy redesign.
