# Coordinator Gate Approval Failure Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one recovery contract for coordinator gate-approval failures so `multi approve-gate` and the dashboard approve action stop collapsing hook-blocked approvals into generic one-line errors.

## Interface

- Shared helper: `normalizeCoordinatorGateApprovalFailure(...)`
- CLI surface: `agentxchain multi approve-gate`
- Dashboard mutation surface: `POST /api/actions/approve-gate`

## Behavior

1. Failure normalization
   - Coordinator gate-approval failures must return a structured body containing:
     - `code`
     - `error`
     - `gate`
     - `gate_type`
     - `hook_phase` when relevant
     - `hook_name` when known
     - ordered `next_actions`
     - `next_action` as the first ordered command when one exists
     - `recovery_summary` with `typed_reason`, `owner`, `recovery_action`, and `detail`
2. Hook-blocked and hook-failed approvals
   - Must explain that the coordinator state is unchanged and the pending gate remains in place.
   - Must tell the operator to fix or reconfigure the blocking hook and then rerun the appropriate coordinator action.
   - Must preserve shared coordinator action ordering from `deriveCoordinatorNextActions(...)`.
3. CLI output
   - Human-readable `multi approve-gate` failures must render gate, hook, error, action, detail, and ordered next actions.
   - `--json` failures must print the normalized structured failure body.
4. Dashboard action output
   - The dashboard approve action API must return the same normalized failure body.
   - The dashboard banner must include the recovery detail and the first next action when a mutation fails.

## Error Cases

- Missing coordinator config still returns a config error before approval.
- Unknown gate type remains a hard failure and must not fabricate hook metadata.
- If shared coordinator next actions are unavailable, `next_actions` must be an empty array rather than omitted.

## Acceptance Tests

- `AT-CLI-MR-016`: hook-blocked `multi approve-gate` prints structured recovery guidance including hook name and ordered next actions.
- `AT-CLI-MR-017`: hook-blocked `multi approve-gate --json` returns normalized failure fields with `next_actions` and `recovery_summary`.
- `AT-DASH-ACT-009`: dashboard approve action returns normalized coordinator hook-block failure fields.
- `AT-DASH-ACT-010`: dashboard app failure handling consumes `payload.next_actions` so the operator sees the next command, not only the raw error string.

## Open Questions

- None for this slice.
