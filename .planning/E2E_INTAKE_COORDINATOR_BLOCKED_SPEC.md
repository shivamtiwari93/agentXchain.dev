# E2E Intake Coordinator Blocked Path Spec

## Purpose

Prove that when a coordinator enters `blocked` state during a handoff-linked workflow, the source repo's intake intent transitions to `blocked` (not `failed`, not `completed`, not stuck in `executing`). This is the failure-path counterpart to `E2E_INTAKE_COORDINATOR_HANDOFF_SPEC.md`.

## Mechanism

The test uses a **real coordinator hook violation** — not synthetic state edits — to drive the coordinator into `blocked`. Specifically:

1. An `after_acceptance` hook that tampers with a protected coordinator state file
2. The hook runner detects the tamper, restores the file, and returns `ok: false`
3. `multi step` calls `blockCoordinator()` with reason `coordinator_hook_violation: ...`
4. The coordinator enters `status: "blocked"` via shipped mechanics

## Proof Boundary

| Step | CLI Command | Assertion |
|------|------------|-----------|
| 1 | `intake record → triage → approve → plan` | Intent reaches `planned` |
| 2 | `multi init` | Coordinator initialized |
| 3 | `intake handoff` | Intent → `executing` with `target_workstream` |
| 4 | `multi step` (dispatch to api) | Turn dispatched to entry repo |
| 5 | Stage + `accept-turn` in api repo | Turn accepted in api |
| 6 | `multi step` (resync triggers after_acceptance hook) | Tamper detected → coordinator → `blocked` |
| 7 | `intake resolve` | Intent → `blocked` (not `failed`) |
| 8 | Assert intent fields | `run_blocked_on`, `run_blocked_reason`, `run_blocked_recovery` present |
| 9 | Assert intent history | `from: "executing"`, `to: "blocked"`, `run_status: "blocked"` |

## Hook Configuration

The coordinator config (`agentxchain-multi.json`) includes:

```json
{
  "hooks": {
    "after_acceptance": [
      {
        "name": "tamper-trigger",
        "type": "process",
        "command": ["node", "-e", "<script that modifies a protected file>"],
        "timeout_ms": 5000
      }
    ]
  }
}
```

The hook script writes to `.agentxchain/multirepo/state.json` (a protected path), triggering tamper detection.

## Non-Goals

- Recovery proof (separate future slice)
- Multi-workstream blocked path
- `before_assignment` or `before_gate` block verdicts (different blocking paths)
- Remote coordinator

## Acceptance Tests

- AT-BLOCKED-E2E-001: Coordinator enters `blocked` via hook tamper, not synthetic state edit
- AT-BLOCKED-E2E-002: `intake resolve` transitions intent from `executing` to `blocked`
- AT-BLOCKED-E2E-003: Intent `run_blocked_reason` contains `coordinator_hook_violation`
- AT-BLOCKED-E2E-004: Intent `run_blocked_recovery` provides actionable guidance
- AT-BLOCKED-E2E-005: Intent history records `from: executing, to: blocked` with `run_status: blocked`
- AT-BLOCKED-E2E-006: Intent does NOT transition to `failed` (semantic correctness)

## Status

Shipped — test passes, 2019 node tests / 449 suites / 0 failures.
