# Dashboard Gate Actions Surface Spec

> Frozen by: Claude Opus 4.6, Turn 29
> Decision: `DEC-DASHBOARD-GATE-ACTIONS-001`

## Purpose

Surface gate-action execution evidence in the dashboard. The CLI `status`, `report`, and `audit` commands already render gate-action attempts. The dashboard currently has zero gate-action visibility — the Gate Review and Blocked State views do not show which actions are configured, whether they have been executed, or why they failed.

## Scope

Repo-local dashboard only. Coordinator-level gate actions are out of scope (gate actions are repo-local by contract per `DEC-GATE-ACTIONS-001`).

## Data Source

`cli/src/lib/gate-actions.js` provides:

- `summarizeLatestGateActionAttempt(root, gateType, gateId)` — returns the latest attempt with all per-action results
- `getGateActions(config, gateId)` — returns configured actions for a gate

The bridge already reads `state.json` (which contains `pending_phase_transition` / `pending_run_completion` with `gate` identifiers) and `decision-ledger.jsonl` (which contains `type: 'gate_action'` entries).

## Contract

### Bridge API

New endpoint: `GET /api/gate-actions`

Returns:
```json
{
  "configured": [{ "index": 1, "label": "Bump version", "run": "bash scripts/bump.sh" }],
  "latest_attempt": {
    "attempt_id": "ga_...",
    "gate_id": "exit_gate_phase_1",
    "gate_type": "phase_transition",
    "status": "failed",
    "attempted_at": "2026-04-16T...",
    "actions": [
      {
        "action_index": 1,
        "action_label": "Bump version",
        "command": "bash scripts/bump.sh",
        "status": "succeeded",
        "exit_code": 0,
        "stdout_tail": "...",
        "stderr_tail": null,
        "timestamp": "..."
      },
      {
        "action_index": 2,
        "action_label": "Tag release",
        "command": "bash scripts/tag.sh",
        "status": "failed",
        "exit_code": 1,
        "stdout_tail": null,
        "stderr_tail": "fatal: tag already exists",
        "timestamp": "..."
      }
    ]
  }
}
```

Returns `{ configured: [], latest_attempt: null }` when no gate is pending or no actions are configured.

### Gate Review component (`gate.js`)

When a pending gate has configured `gate_actions`:
- Show a "Gate Actions" section after the evidence summary, before the approve controls
- List each configured action: index, label (or command), and the exact `run` command
- If a previous attempt exists, show attempt status and per-action outcomes

### Blocked State component (`blocked.js`)

When `blocked_reason.category === 'gate_action_failed'`:
- Show a "Gate Action Failure" section with the latest attempt details
- For each action in the attempt: index, label, status, exit code
- For the failed action: show `stderr_tail` in a `<pre>` block
- Show the gate-type-correct `--dry-run` CLI command as guidance

## Acceptance Tests

- `AT-DASH-GA-001`: `/api/gate-actions` returns configured actions and latest attempt for a pending gate
- `AT-DASH-GA-002`: `/api/gate-actions` returns empty when no gate is pending
- `AT-DASH-GA-003`: Gate Review renders configured gate actions when present
- `AT-DASH-GA-004`: Blocked view renders gate-action failure details when `category === 'gate_action_failed'`
- `AT-DASH-GA-005`: Blocked view shows stderr tail for the failed action
- `AT-DASH-GA-006`: Gate Review shows previous attempt status when a re-approval is pending
- `AT-DASH-GA-007`: Blocked view shows `agentxchain approve-completion --dry-run` for run-completion gate-action failures
- `AT-DASH-GA-008`: Bridge → render pipeline surfaces real CLI-produced gate-action failures without shape drift

## Out of Scope

- Re-running gate actions from the dashboard UI (mutation surface — future work)
- Coordinator-level gate actions (not supported by runtime)
- `--dry-run` execution from dashboard (CLI-only per `DEC-GATE-ACTIONS-001`)
