# Coordinator Report Action Guidance Spec

> `DEC-COORD-ACTIONS-001` — coordinator governance reports must surface deterministic next actions from verified coordinator state, not just historical narrative

## Purpose

The coordinator governance report now explains what happened, when it happened, and how barriers changed. It still fails the most practical operator question:

**What should I do next?**

That gap is real. The report already has enough verified state to answer some next-step questions without guessing:

- coordinator blocked with a persisted reason
- coordinator paused behind a pending gate
- coordinator active with no pending gate
- coordinator state drifted from child repo truth

This spec adds a narrow, deterministic action-guidance surface to the `coordinator_workspace` report. It does **not** try to prescribe every possible operator workflow. It only surfaces commands that can be derived directly from the verified export artifact.

## Interface

Add the following fields to `subject.run` for `subject.kind = coordinator_workspace`:

```js
{
  // existing fields unchanged ...

  blocked_reason: string | null,
  pending_gate: {
    gate: string,
    gate_type: string,
    from?: string,
    to?: string,
    required_repos?: string[],
    human_barriers?: string[],
    requested_at?: string,
  } | null,

  next_actions: [
    {
      command: string,
      reason: string,
    }
  ],
}
```

## Behavior

### 1. State extraction

- Read `blocked_reason` and `pending_gate` from `.agentxchain/multirepo/state.json`.
- Do not invent these values from timeline inference when the state file lacks them.

### 2. Action derivation order

Derive `next_actions` in strict priority order:

1. **Blocked coordinator**
   - First action: `agentxchain multi resume`
   - Reason must mention that the coordinator is blocked and include `blocked_reason` when present.
   - If a `pending_gate` also exists, add a second action:
     - `agentxchain multi approve-gate`
     - Reason must make clear this is the follow-up after resume, not the first step.

2. **Coordinator/child drift**
   - If any verified child repo export status disagrees with `state.repo_runs[repo_id].status`, emit:
     - `agentxchain multi resync`
   - Reason must name the drifted repo ids.
   - This recommendation applies only when the coordinator is not currently blocked.

3. **Pending gate**
   - If `pending_gate` exists and the coordinator is not blocked, emit:
     - `agentxchain multi approve-gate`
   - Reason must include the gate id and gate type.

4. **Runnable coordinator**
   - If coordinator status is `active` or `paused`, and there is no higher-priority action, emit:
     - `agentxchain multi step`
   - Reason must state that there is no blocked state or pending gate.

5. **Completed coordinator**
   - Emit no next actions.

### 3. Human-readable rendering

Text and markdown reports add a `Next Actions` section when `next_actions.length > 0`.

The section should:

- render actions in priority order
- show the exact command in monospace or plain literal form
- include the one-line reason beside each command

### 4. Scope limits

This surface must stay deterministic. Do **not** add recommendations that require speculative interpretation, such as:

- “talk to the team”
- “check the dashboard”
- “approve a gate” when no `pending_gate` exists
- “resume” when the coordinator is not blocked

## Error Cases

- Missing or malformed `.agentxchain/multirepo/state.json` fields degrade to `null` / empty arrays.
- Drift detection ignores failed child repo exports (`ok: false`) because their live status is unverified.
- If `blocked_reason` exists but is not a non-empty string, the report may fall back to a generic blocked reason.

## Acceptance Tests

- `AT-COORD-ACT-001`: blocked coordinator report surfaces `run.blocked_reason`, `run.pending_gate`, and ordered `next_actions` of `multi resume` then `multi approve-gate` when both conditions exist.
- `AT-COORD-ACT-002`: paused coordinator with a pending gate but no blocked state recommends only `agentxchain multi approve-gate`.
- `AT-COORD-ACT-003`: active coordinator with no blocked state or pending gate recommends `agentxchain multi step`.
- `AT-COORD-ACT-004`: coordinator report with child/coordinator status drift recommends `agentxchain multi resync` and names the drifted repo ids.
- `AT-COORD-ACT-005`: completed coordinator emits no `Next Actions` section in text or markdown.
- `AT-COORD-ACT-006`: governance report docs mention `blocked_reason`, `pending_gate`, `next_actions`, and the `Next Actions` human-readable section.

## Open Questions

None. This is a report-layer derivation over already-exported truth.
