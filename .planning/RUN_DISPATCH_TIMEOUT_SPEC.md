# Run Dispatch Timeout Specification

## Purpose

Close the real lights-out gap where a governed `run` can hang forever during adapter dispatch even though `timeouts.per_turn_minutes` already exists. The product already has timeout config, timeout status visibility, and accept-turn timeout enforcement. What it lacked was in-flight enforcement while a turn is still running.

This spec adds runner-side dispatch timeout blocking for governed `run` / `runLoop` without inventing a new timeout surface or silently changing timeout defaults.

## Interface

### Existing config surface

No new config keys.

Dispatch timeout enforcement reuses the existing top-level config:

```json
{
  "timeouts": {
    "per_turn_minutes": 30,
    "action": "escalate"
  }
}
```

### Affected modules

- `cli/src/lib/run-loop.js`
- `cli/src/commands/run.js`
- `cli/src/lib/governed-state.js` state contract is reused, not replaced
- `website-v2/docs/timeouts.mdx`

## Behavior

### In-flight dispatch enforcement

When all of the following are true:

1. the runner is executing through `runLoop`
2. a turn is actively being dispatched
3. `timeouts.per_turn_minutes` is configured
4. the effective turn timeout action is `escalate`

the runner must enforce the timeout during dispatch, not only after acceptance.

If the dispatch exceeds the remaining turn timeout budget:

1. the runner aborts the dispatch if the runner-specific dispatch path supports an abort signal
2. the run is marked `blocked`
3. `blocked_on` is set to `timeout:turn`
4. `blocked_reason.category` is `timeout`
5. the active turn is retained for operator inspection / recovery
6. a `type: "timeout"` entry is appended to `.agentxchain/decision-ledger.jsonl`
7. `runLoop` returns `stop_reason: "blocked"`

### Scope boundary

This slice only changes **turn-scope in-flight dispatch** behavior.

It does **not** change:

- phase timeout evaluation
- run timeout evaluation
- approval-pending timeout exemption
- global timeout defaults
- acceptance-boundary timeout enforcement

### Warn mode boundary

`timeouts.action: "warn"` remains non-mutating. It does not interrupt an in-flight dispatch. This spec does not pretend a hung adapter can be safely "warn-only" interrupted without escalating the run. The truthful contract is:

- `warn` continues to surface read-only timeout pressure
- `escalate` is the mode that can block a hung in-flight turn

### Status truth

`agentxchain status` already shows elapsed time for active turns. This slice does not invent a second elapsed clock. The docs must instead explain that:

- `status` is the read-only visibility surface
- `accept-turn` remains the acceptance-boundary mutation point
- `run` / `runLoop` also enforce **in-flight turn timeout escalation** during dispatch

## Error Cases

- If a dispatch times out and the runner cannot abort the underlying worker, the run still blocks immediately. The active turn remains retained. Runner-specific cleanup is best-effort, not a reason to keep the governance loop hanging.
- If `markRunBlocked()` fails, `runLoop` returns a blocked/error outcome instead of pretending the timeout was handled.
- If the decision-ledger append fails after the blocked state is written, the run is still blocked. The runner records the append failure in `result.errors`.

## Acceptance Tests

- `AT-RUN-TIMEOUT-001`: `runLoop` blocks an active turn when in-flight dispatch exceeds `timeouts.per_turn_minutes` with `action: "escalate"`.
- `AT-RUN-TIMEOUT-002`: the timed-out turn remains active/retained after the block.
- `AT-RUN-TIMEOUT-003`: a `type: "timeout"` decision-ledger entry is written for the blocked dispatch timeout.
- `AT-RUN-TIMEOUT-004`: the real `agentxchain run` CLI blocks with `blocked_on: "timeout:turn"` and prints recovery guidance when a `local_cli` dispatch hangs past the configured turn timeout.
- `AT-RUN-TIMEOUT-005`: public timeout docs name `run` / `runLoop` as the in-flight dispatch timeout enforcement path and keep approval-command behavior truthful.

## Open Questions

- Whether the dashboard and `status --json` should grow a first-class "remaining turn budget" field for active dispatches. Valuable, but not required to close the stuck-turn gap.
- Whether future runner APIs should expose a typed dispatch-timeout helper instead of letting `runLoop` own the enforcement internally.
