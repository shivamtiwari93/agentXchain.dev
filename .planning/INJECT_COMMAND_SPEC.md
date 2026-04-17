# Inject Command Spec

## Purpose

Provide a single-command operator surface for injecting priority work into the intake queue during continuous or lights-out execution. `agentxchain inject` composes `intake record` + `intake triage` + `intake approve` into one atomic operation, so the operator can express "do this next" without running three separate commands.

## Interface

```
agentxchain inject "<description>" [options]

Required:
  <description>            Free-text description of the work to inject

Options:
  --priority <level>       Priority (p0, p1, p2, p3) — default: p0
  --template <id>          Governed template (generic, api-service, cli-tool, library, web-app, enterprise-app) — default: generic
  --charter <text>         Delivery charter (defaults to description if omitted)
  --acceptance <text>      Comma-separated acceptance criteria (optional)
  --approver <name>        Approver identity — default: "human"
  --no-approve             Stop at triaged state instead of auto-approving
  -j, --json               Output as JSON
```

## Behavior

### Happy path

1. Create a `manual` source event with signal `{ description, injected: true, priority }` and evidence `[{ type: "text", value: description }]`.
2. Immediately triage the resulting intent to the specified priority, template, charter, and acceptance criteria.
3. Unless `--no-approve` is set, immediately approve the intent with `approver` set to the `--approver` value (default `"human"`).
4. Write a preemption marker to `.agentxchain/intake/injected-priority.json` containing `{ intent_id, priority, injected_at }` so the run loop and status command can detect the injection without scanning all intents.
5. Print the intent ID, priority, and status to stdout. If `--json`, output the full intent object.

### Preemption contract

When an intent is injected with priority `p0`:

1. The preemption marker file `.agentxchain/intake/injected-priority.json` is written atomically.
2. The run loop (`runLoop`) checks for this marker at the **top of each iteration** (after `loadState`, before `selectRole`). If a marker exists and the current run has no active turns:
   - Emit a `priority_injected` event with the intent ID and priority.
   - Return `{ ok: false, stop_reason: 'priority_preempted', preempted_by: intent_id }`.
3. The scheduler/daemon detects `priority_preempted` and evaluates the injected intent as the next work item.
4. Non-p0 injections do NOT trigger preemption — they enter the queue for normal priority ordering.

### Preemption visibility in `agentxchain status`

When a preemption marker exists:

```
⚡ Priority injection pending
  Intent: intent_1713300000000_a1b2
  Priority: p0
  Description: Fix the sidebar ordering
  Injected at: 2026-04-17T12:00:00Z
  Effect: Will preempt current workstream after this turn completes
```

This section appears above the normal run status when a marker is present.

### Marker lifecycle

- Written by `agentxchain inject` when priority is `p0`.
- Consumed (deleted) by the run loop when it acts on the preemption, or by `intake start` when the injected intent enters execution.
- Stale markers (intent already terminal or executing) are cleaned up by `status` and `intake status`.

## Error Cases

| Condition | Behavior |
|-----------|----------|
| Empty description | Exit 1: "description is required" |
| Invalid priority | Exit 1: "priority must be one of: p0, p1, p2, p3" |
| Invalid template | Exit 1: "template must be one of: ..." |
| Record fails (dedup) | Show existing intent, no error |
| Triage fails | Exit 1: surface triage error |
| Approve fails | Exit 1: surface approve error |

## Acceptance Tests

- `AT-INJECT-001`: `agentxchain inject "Fix sidebar" --priority p0` creates an event, intent in `approved` status with priority `p0`, and writes preemption marker.
- `AT-INJECT-002`: `agentxchain inject "Low priority cleanup" --priority p2` creates an intent in `approved` status with no preemption marker.
- `AT-INJECT-003`: `agentxchain inject "..." --no-approve` creates an intent in `triaged` status.
- `AT-INJECT-004`: `agentxchain status` shows preemption section when marker exists.
- `AT-INJECT-005`: Run loop returns `priority_preempted` when a p0 marker is present and no active turns exist.
- `AT-INJECT-006`: Preemption marker is cleaned up when the injected intent enters execution.
- `AT-INJECT-007`: Duplicate inject (same description) returns existing intent without error.

## Open Questions

- Whether `p1` should also trigger preemption (current spec: only `p0`). Start conservative.
- Whether `inject` should auto-plan as well (current spec: stops at `approved` — operator or automation runs `intake plan` + `intake start` separately, or the continuous loop picks it up).
