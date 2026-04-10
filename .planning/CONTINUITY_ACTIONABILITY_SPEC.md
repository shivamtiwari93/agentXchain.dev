# Continuity Actionability Spec

**Status:** implemented
**Author:** GPT 5.4 (Turn 38)

## Purpose

Make the continuity surfaces actionable and truthful before an operator runs `restart`.

Checkpoint visibility alone is not enough. Operators also need to know:

- whether the workspace has drifted since the last checkpoint
- whether `agentxchain restart` is actually the right next command
- when a pending human gate changes the truthful next action to `approve-transition` or `approve-completion`

This slice corrects the over-broad continuity guidance where `restart` could be recommended for approval-pending runs even though the run already had a more specific operator action.

## Interface

### CLI status

- `agentxchain status`
- `agentxchain status --json`

### Dashboard continuity endpoint and panel

- `GET /api/continuity`
- Timeline continuity panel

### Additive continuity fields

- `continuity.recommended_command`
- `continuity.recommended_reason`
- `continuity.recommended_detail`
- `continuity.drift_detected`
- `continuity.drift_warnings`

Backward-compat field retained:

- `continuity.restart_recommended`
  - true only when `recommended_command` is `agentxchain restart`

## Behavior

Continuity action selection follows governed state, not guesswork:

- if `pending_phase_transition` exists, the recommended command is `agentxchain approve-transition`
- if `pending_run_completion` exists, the recommended command is `agentxchain approve-completion`
- otherwise, if the run is continuity-restartable, the recommended command is `agentxchain restart`
- blocked and terminal runs expose no continuity command

Checkpoint drift is evaluated from `session.json.baseline_ref` against the current workspace:

- compare git HEAD
- compare branch
- compare clean vs dirty workspace state

Drift is only evaluated when the checkpoint belongs to the current `run_id`. A stale checkpoint is already a stronger warning; drift derived from another run's checkpoint is not operator-truthful.

Human-readable status and the dashboard continuity panel must render:

- the recommended command when one exists
- the recommended-detail context when it exists
- drift warnings when drift is detected
- an explicit “no drift detected” line when a checkpoint baseline exists and still matches

## Error Cases

- Missing `baseline_ref` or non-git workspace:
  - `drift_detected` is `null`
  - `drift_warnings` is empty
- Stale checkpoint:
  - stale warning remains visible
  - drift evaluation is omitted (`drift_detected = null`)
- Blocked or terminal runs:
  - `recommended_command` is `null`
  - `restart_recommended` is `false`

## Acceptance Tests

- `AT-CA-001`: `status --json` exposes `recommended_command`, `recommended_reason`, and `recommended_detail`, and does not recommend `restart` when a phase approval is pending.
- `AT-CA-002`: `status` and `status --json` surface checkpoint drift truthfully from `baseline_ref`.
- `AT-CA-003`: `GET /api/continuity` returns the additive actionability fields for dashboard consumers.
- `AT-CA-004`: Timeline continuity panel renders the exact command and drift state instead of restart-only guidance.
- `AT-CA-005`: CLI and multi-session docs describe the actionability contract in the same turn.

## Open Questions

None for this slice. Coordinator continuity remains a separate contract because child-repo recovery semantics are different from repo-local session restart.
