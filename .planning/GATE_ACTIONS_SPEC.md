# Gate Actions Spec

## Purpose

Allow a human-approved gate to run repo-local post-approval automation without leaving AgentXchain in a false "approved but not actually shipped" state.

This is for narrow, explicit automation that should happen only after a gate requiring human approval is approved, such as release tagging, publishing, or deployment wrappers.

## Interface

Gate actions live on the gate definition itself, not in `workflow_kit`:

```json
{
  "gates": {
    "qa_ship_verdict": {
      "requires_human_approval": true,
      "gate_actions": [
        { "label": "publish release", "run": "bash scripts/publish-release.sh", "timeout_ms": 900000 },
        { "label": "deploy docs", "run": "bash scripts/deploy-docs.sh", "timeout_ms": 900000 }
      ]
    }
  }
}
```

CLI:

- `agentxchain approve-transition [--dry-run]`
- `agentxchain approve-completion [--dry-run]`

Ledger surface:

- `.agentxchain/decision-ledger.jsonl`
- new entry type: `gate_action`

Status/report/audit surfaces read those `gate_action` entries and expose the latest evidence.

## Behavior

1. `gate_actions` is valid only on `gates.<gate_id>` and only when that gate has `requires_human_approval: true`.
2. `--dry-run` previews the configured actions and does not execute hooks, actions, or state mutation.
3. Real approval still runs `before_gate` hooks first.
4. If hooks pass, gate actions execute sequentially in the repo root via `/bin/sh -lc`.
5. Gate actions run with repo-root workspace access. They are not isolated in a scratch directory. Workspace mutation is allowed, but it must be intentional and rerunnable because those writes become part of the approval boundary.
6. Each action uses `timeout_ms` when provided; otherwise the runtime applies a default per-action timeout of 900000ms (15 minutes).
7. Approval finalization happens only after all gate actions succeed.
8. If any gate action fails:
   - the pending gate remains pending
   - the run becomes `blocked`
   - `blocked_reason.category` becomes `gate_action_failed`
   - recovery remains the same approval command (`approve-transition` or `approve-completion`)
9. Because retries reuse the same approval command, configured gate-action commands must be idempotent and safe to rerun.
10. Every executed gate action appends a `gate_action` ledger entry with:
   - gate id/type
   - action index and label
   - command
   - timeout configuration
   - status
   - exit code / signal / timeout flag
   - stdout/stderr tails
   - timestamp
   - approval attempt id
11. `status` shows the latest gate-action attempt for the current pending gate.
12. `report` and `audit` include gate-action evidence from the decision ledger.

Environment variables exposed to gate-action commands:

- `AGENTXCHAIN_GATE_ID`
- `AGENTXCHAIN_GATE_TYPE`
- `AGENTXCHAIN_PHASE`
- `AGENTXCHAIN_REQUESTED_BY_TURN`
- `AGENTXCHAIN_TRIGGER_COMMAND`

## Error Cases

- `gate_actions` present on a gate without `requires_human_approval: true` → config error.
- `gate_actions` not an array, empty array, or action missing `run` → config error.
- `timeout_ms` present but outside `1000..3600000` or not an integer → config error.
- gate action exits non-zero or fails to spawn → approval fails with `gate_action_failed`, pending gate stays intact, run blocks for retry.
- gate action exceeds its timeout → approval fails with `gate_action_failed`, pending gate stays intact, run blocks for retry, and timeout evidence is persisted in the ledger/state.
- malformed ledger line during status/report reads → ignore that line rather than failing the command.

## Acceptance Tests

- `AT-GA-001`: config validation rejects `gate_actions` on a non-human gate.
- `AT-GA-002`: `approve-transition --dry-run` previews gate actions and does not mutate state or write side-effect files.
- `AT-GA-003`: successful gate actions run sequentially and phase approval completes normally.
- `AT-GA-004`: failing gate action blocks the run, preserves the pending gate, and records gate-action evidence in the decision ledger.
- `AT-GA-005`: `status` shows the latest failed gate-action attempt for the pending gate.
- `AT-GA-006`: `report --format json` exposes `subject.run.gate_actions` with status, command, and exit metadata.
- `AT-GA-007`: config validation rejects invalid `timeout_ms` values on gate actions.
- `AT-GA-008`: a gate action that exceeds `timeout_ms` fails the approval, preserves the pending gate, and records timeout evidence in the ledger/state.

## Open Questions

- Should a later slice add structured action types (`npm_publish`, `git_tag`, `workflow_dispatch`) on top of shell commands for safer retries and clearer audit semantics?
- Should coordinator-level pending gates gain their own gate-action contract, or stay repo-local until the retry/recovery shape is battle-tested?
