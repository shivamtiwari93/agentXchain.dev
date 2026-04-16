# Coordinator CLI Handoff Output Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze one truthful post-action handoff contract for coordinator CLI surfaces so `multi resume` and successful `multi approve-gate` do not collapse the operator handoff to a one-line status while dashboard actions already expose richer next-step data.

## Interface

- Shared helper: `normalizeCoordinatorGateApprovalSuccess(...)`
- CLI surfaces:
  - `agentxchain multi resume`
  - `agentxchain multi approve-gate`

## Behavior

1. `multi resume`
   - Human-readable output must print:
     - `Coordinator resumed: ...`
     - `Previous block: ...`
     - canonical `Pending Gate:` detail rows via `getCoordinatorPendingGateDetails(...)` when recovery lands in `paused` with `pending_gate`
     - ordered next actions from shared coordinator action derivation
   - `--json` output must expose `next_action` and `next_actions` alongside `resumed_status`, `blocked_reason`, `pending_gate`, and `resync`.
2. Successful `multi approve-gate`
   - Human-readable output must render a success message plus ordered next actions from the same approval-success contract used by dashboard gate actions.
   - Phase-transition approvals must surface `agentxchain multi step` as the next action when the coordinator returns to `active`.
   - Run-completion approvals must not invent a synthetic follow-up command; `next_action` must be `null` and `next_actions` must be `[]`.
   - `--json` output must expose `ok`, `gate_type`, `status`, `phase`, `message`, `next_action`, and `next_actions`.
3. Shared success contract
   - Coordinator CLI and dashboard success payloads must derive from one shared normalization helper instead of duplicating message and next-action logic in separate files.

## Error Cases

- If `multi resume` restores `active` with no `pending_gate`, it must omit the `Pending Gate:` section and still print ordered next actions.
- If a successful approval returns no follow-up action, human-readable output must stop at the success message instead of printing an empty `Next Actions:` block.

## Acceptance Tests

- `AT-MR-REC-003`: `multi resume` restores `active` and surfaces `agentxchain multi step` as the next action.
- `AT-CLI-MR-021`: `multi resume` restoring `paused` with a `pending_gate` prints canonical `Pending Gate:` rows plus ordered next actions.
- `AT-CLI-MR-022`: `multi resume --json` restoring `paused` includes `next_action` and `next_actions`.
- `AT-CLI-MR-023`: successful phase-transition `multi approve-gate` prints the shared success message and ordered next actions.
- `AT-CLI-MR-024`: successful phase-transition `multi approve-gate --json` returns normalized success fields with `next_action`.
- `AT-CLI-MR-025`: successful run-completion `multi approve-gate --json` returns `next_action: null` and `next_actions: []`.

## Open Questions

- None for this slice.
