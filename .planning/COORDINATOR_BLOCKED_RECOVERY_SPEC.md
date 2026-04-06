# Coordinator Blocked Recovery Spec

**Status:** Draft
**Owner:** GPT 5.4
**Last Updated:** 2026-04-06

## Purpose

Ship a real operator recovery path for blocked multi-repo coordinators.

Today the coordinator can enter `status: "blocked"` through shipped mechanics, but there is no corresponding CLI command that clears the blocked state after the operator resolves the cause. That makes intake-to-coordinator blocked recovery unprovable and leaves the multi-repo workflow kit with a real product hole.

This spec defines the missing recovery contract.

## Interface

### CLI

```bash
agentxchain multi resume [--json]
```

### Inputs

- Current working directory must be a coordinator workspace containing `agentxchain-multi.json`
- `.agentxchain/multirepo/state.json` must exist
- Coordinator `state.status` must be `blocked`

### Output

Human mode:
- Prints the prior blocked reason
- Prints the recovered status (`active` or `paused`)
- Tells the operator the next truthful command:
  - `agentxchain multi step` when resumed to `active`
  - `agentxchain multi approve-gate` when resumed to `paused` with `pending_gate`

JSON mode:

```json
{
  "ok": true,
  "previous_status": "blocked",
  "resumed_status": "active",
  "blocked_reason": "coordinator_hook_violation: ...",
  "pending_gate": null,
  "resync": {
    "ok": true,
    "resynced_repos": ["api"],
    "projected_acceptances": [],
    "barrier_changes": []
  }
}
```

## Behavior

### Recovery source of truth

1. Repo-local governed state remains authoritative.
2. `multi resume` MUST run coordinator resync before clearing blocked state.
3. `multi resume` MUST NOT write to repo-local `.agentxchain/` artifacts.

### Resume eligibility

`multi resume` may clear the coordinator blocked state only when all of the following are true:

1. Resync succeeds without producing a new coordinator blocked reason.
2. No child repo is still `status: "blocked"` in the refreshed `repo_runs` snapshot.
3. The coordinator state file still belongs to the same `super_run_id`.

If any of those conditions fail, the coordinator remains blocked and the command exits non-zero.

### Restored status

After a successful recovery:

1. If `pending_gate` exists, coordinator status becomes `paused`.
2. Otherwise coordinator status becomes `active`.
3. `blocked_reason` is cleared.

This is deliberate. Recovery restores the coordinator to the truthful precondition for the next operator action; it does not silently dispatch a new turn or auto-approve a gate.

### Audit trail

Successful recovery MUST append a coordinator history entry:

```json
{
  "type": "blocked_resolved",
  "timestamp": "2026-04-06T00:00:00.000Z",
  "super_run_id": "srun_...",
  "from": "blocked",
  "to": "active",
  "blocked_reason": "coordinator_hook_violation: ...",
  "pending_gate": null
}
```

`multi resume` may also append the normal `state_resynced` event because recovery includes a real resync.

## Error Cases

1. No coordinator state exists:
   - Exit non-zero
   - Message: run `agentxchain multi init` first

2. Coordinator is not blocked:
   - Exit non-zero
   - Message names the actual status

3. Resync still yields a blocked coordinator:
   - Exit non-zero
   - Message includes the current blocked reason

4. Any child repo remains blocked after resync:
   - Exit non-zero
   - Message names the blocked repo IDs

## Acceptance Tests

- `AT-MR-REC-001`: `multi resume` rejects when no coordinator state exists.
- `AT-MR-REC-002`: `multi resume` rejects when coordinator status is not `blocked`.
- `AT-MR-REC-003`: `multi resume` clears blocked state to `active` when no pending gate exists and all child repos are healthy.
- `AT-MR-REC-004`: `multi resume` restores blocked state to `paused` when a coherent `pending_gate` exists.
- `AT-MR-REC-005`: `multi resume` refuses recovery while any child repo remains blocked.
- `AT-MR-REC-006`: successful recovery appends `blocked_resolved` to coordinator history.
- `AT-MR-REC-E2E-001`: repo-local intake handoff blocked by coordinator hook violation can recover through `multi resume`, continue coordinator execution, and later resolve the source intent from `blocked` to `completed`.

## Open Questions

1. Hook-induced halts are asymmetric today:
   - `after_acceptance` tamper failures enter `status: "blocked"`
   - `before_assignment` and `before_gate` block/failure paths exit non-zero without persisting coordinator blocked state

This spec does not normalize that asymmetry. It only ships recovery for states that are already persisted as coordinator `blocked`.
