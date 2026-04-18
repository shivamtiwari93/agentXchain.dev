# Mission Plan Launch --all-ready Spec

**Status:** completed

## Purpose

Enable launching all currently `ready` workstreams from an approved plan in a single command with dependency-aware ordering and fail-closed partial-failure behavior.

Today `mission plan launch` launches one workstream at a time via `--workstream <id>`. When a plan has multiple independent workstreams (no dependencies between them), the operator must issue N separate launch commands. `--all-ready` removes that ceremony while preserving the fail-closed governance boundary.

## Interface

### CLI

```bash
agentxchain mission plan launch [plan_id|latest] --all-ready [--mission <mission_id>] [--auto-approve] [--json] [--dir <path>]
```

`--all-ready` and `--workstream <id>` are mutually exclusive. The command fails closed if both are supplied.

### Library

```js
// New export from mission-plans.js
function getReadyWorkstreams(plan)
// Returns workstream objects where launch_status === 'ready', ordered by plan position.
```

The launch command iterates `getReadyWorkstreams(plan)` sequentially. No parallel dispatch in the first implementation — sequential is safer and the dependency graph may change mid-execution as outcomes are recorded.

## Behavior

### 1. Resolve ready workstreams at launch time

`--all-ready` collects all workstreams with `launch_status === 'ready'` from the resolved plan. If zero workstreams are ready, the command fails closed with an explicit message listing the current status distribution (how many are blocked, launched, completed, needs_attention).

### 2. Sequential launch with interleaved outcome recording

Each ready workstream is launched and executed one at a time:

1. Call `launchWorkstream()` — records bookkeeping, gets chain ID.
2. Execute through `executeChainedRun()`.
3. Call `markWorkstreamOutcome()` — records terminal status, recalculates dependency graph.

After each outcome, the plan is reloaded from disk to pick up any dependency unblocking. Workstreams that were `blocked` at the start of the command may become `ready` mid-execution if their dependencies complete successfully. These newly-ready workstreams are **not** automatically launched — only the set that was `ready` at invocation time is launched. This prevents scope creep within a single command invocation.

### 3. Fail-closed on first launch failure

If any workstream launch fails (bookkeeping failure, execution error, or `needs_attention` outcome):

- That workstream is marked `needs_attention` per the existing contract.
- The remaining unlaunched workstreams in the batch are **skipped** — they are not launched.
- The command reports which workstreams were launched, which succeeded, which failed, and which were skipped.
- Exit code is non-zero if any workstream failed.

This prevents one corrupted launch from cascading into the rest of the batch. The operator can inspect the plan state and decide whether to retry or replan.

### 4. JSON output

In `--json` mode, the command emits:

```json
{
  "plan_id": "...",
  "mission_id": "...",
  "results": [
    {
      "workstream_id": "ws-a",
      "chain_id": "chain-xxx",
      "status": "completed",
      "exit_code": 0
    },
    {
      "workstream_id": "ws-b",
      "chain_id": "chain-yyy",
      "status": "needs_attention",
      "exit_code": 1
    },
    {
      "workstream_id": "ws-c",
      "status": "skipped",
      "skip_reason": "prior workstream failed"
    }
  ],
  "summary": {
    "total": 3,
    "completed": 1,
    "failed": 1,
    "skipped": 1
  }
}
```

### 5. Text output

Each workstream launch prints a status line as it progresses:

```
Launching 3 ready workstreams from plan <plan_id>...

[1/3] ws-alignment → chain-xxx ... completed ✓
[2/3] ws-testing   → chain-yyy ... needs_attention ✗
[3/3] ws-docs      — skipped (prior workstream failed)

Summary: 1 completed, 1 failed, 1 skipped
```

## Error Cases

| Condition | Required behavior |
|---|---|
| Both `--all-ready` and `--workstream` supplied | Fail closed: mutually exclusive options. |
| Zero ready workstreams | Fail closed with status distribution. |
| Plan not approved | Fail closed (existing `launchWorkstream` behavior). |
| First workstream execution fails | Mark `needs_attention`, skip remaining, exit non-zero. |
| Mid-batch workstream fails | Same: mark failed, skip rest, exit non-zero. |
| All workstreams complete successfully | Exit zero, plan shows all launched workstreams as `completed`. |

## Acceptance Tests

- `AT-MISSION-PLAN-042`: `--all-ready` and `--workstream` are mutually exclusive — command rejects both.
- `AT-MISSION-PLAN-043`: `--all-ready` with zero ready workstreams fails closed with status summary.
- `AT-MISSION-PLAN-044`: `--all-ready` launches all ready workstreams sequentially and records outcomes.
- `AT-MISSION-PLAN-045`: blocked workstreams stay blocked and are not launched.
- `AT-MISSION-PLAN-046`: first workstream failure stops remaining launches (skip behavior).
- `AT-MISSION-PLAN-047`: `getReadyWorkstreams` returns only `ready` workstreams in plan order.

## Open Questions

None. The spec is narrow enough to implement without further design decisions.
