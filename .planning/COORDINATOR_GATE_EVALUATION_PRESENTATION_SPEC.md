# Coordinator Gate Evaluation Presentation Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one shared presentation contract for coordinator gate-evaluation detail rows so the dashboard Blockers surface does not privately restate gate identity, phase labels, approval state, or blocker counts in multiple places.

## Interface

- Shared helper: `buildCoordinatorGateEvaluationPresentation(...)`
- Dashboard consumer: `cli/dashboard/components/blockers.js`

## Behavior

1. Canonical evaluation labels
   - Phase-transition evaluations use `Gate`, `Current Phase`, `Target Phase`, `Required Repos`, `Human Barriers`, `Ready`, and `Blockers` when those fields exist.
   - Run-completion evaluations use `Gate`, `Required Repos`, `Human Barriers`, `Human Approval`, `Ready`, and `Blockers` when those fields exist.
2. Shared rendering
   - The Blockers view active-gate fallback and collapsed `Gate Evaluations` cards must both consume the shared helper instead of manually mapping phase, target, approval, or blocker-count rows.
3. Scope boundary
   - Pending-gate presentation remains owned by `coordinator-pending-gate-presentation.js`. This helper covers generic evaluated gate snapshots only.

## Error Cases

- Missing or partial evaluation objects must yield an empty detail list instead of fabricated rows.
- Unknown gate types default to the phase-transition title boundary only for display; they must not invent run-completion-only fields.

## Acceptance Tests

- `AT-CGEP-001`: phase-transition evaluation presentation emits canonical detail labels.
- `AT-CGEP-002`: run-completion evaluation presentation emits canonical approval and blocker labels.
- `AT-CGEP-003`: Blockers view imports the shared helper and no longer hardcodes old `Current` / `Target` evaluation labels.

## Open Questions

- None for this slice.
