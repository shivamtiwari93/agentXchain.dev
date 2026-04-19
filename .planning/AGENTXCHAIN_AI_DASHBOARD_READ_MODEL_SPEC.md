## AgentXchain.ai Dashboard Read-Model and Actionability Spec

**Status:** Active
**Created:** Turn 291 — Claude Opus 4.6
**Depends on:** `AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md`, `AGENTXCHAIN_AI_DASHBOARD_MUTATION_SPEC.md`, `AGENTXCHAIN_AI_EXECUTION_PLANE_SPEC.md`

### Purpose

Define the server-projected actionability contract that the `.ai` dashboard consumes so the browser never infers mutation eligibility from stale local view state.

The dashboard mutation spec (`DEC-AI-DASHBOARD-MUTATIONS-001`) says "the server, not the browser, decides actionability." This spec defines exactly what that server projection looks like: the shape of the actionability payload, how it stays consistent across run state transitions, how it degrades when the view is stale, and how it remains audit/export-compatible.

Without this spec, every dashboard frontend implementation will silently reinvent eligibility logic from raw run JSON — producing the same "looks valid, actually stale" problem that BUG-46 exposed in the CLI's checkpoint/resume/acceptance triad.

### Interface

#### Actionability projection endpoint

```
GET /v1/runs/:run_id/actionability
Authorization: Bearer <token>
```

Returns the canonical set of actions the current operator may perform on this run at this moment.

#### Response payload

```json
{
  "run_id": "run_<ulid>",
  "run_status": "active",
  "phase": "qa",
  "projection_version": 42,
  "projected_at": "2026-04-19T22:00:00.000Z",
  "pending_approvals": [
    {
      "action": "approve_transition",
      "gate": "implementation_complete",
      "target_phase": "qa",
      "eligible": true,
      "reason": "Gate evaluation passed; awaiting operator approval"
    }
  ],
  "turn_actions": [
    {
      "turn_id": "turn_<ulid>",
      "role": "qa",
      "status": "accepted",
      "available_actions": [
        {
          "action": "checkpoint_turn",
          "eligible": true,
          "reason": "Accepted turn has checkpointable files_changed"
        }
      ]
    },
    {
      "turn_id": "turn_<ulid>",
      "role": "dev",
      "status": "failed",
      "available_actions": [
        {
          "action": "retry_turn",
          "eligible": true,
          "reason": "Turn failed during execution; retry available"
        }
      ]
    },
    {
      "turn_id": "turn_<ulid>",
      "role": "dev",
      "status": "failed_acceptance",
      "available_actions": [
        {
          "action": "retry_turn",
          "eligible": true,
          "reason": "Turn failed acceptance validation; retry available"
        }
      ]
    }
  ],
  "checkpoint_actions": [
    {
      "checkpoint_id": "ckpt_<ulid>",
      "turn_id": "turn_<ulid>",
      "checkpoint_sha": "abc123",
      "available_actions": [
        {
          "action": "restart_from_checkpoint",
          "eligible": true,
          "reason": "Valid checkpoint; restart available"
        }
      ]
    }
  ],
  "run_actions": [
    {
      "action": "cancel_run",
      "eligible": true,
      "reason": "Run is active and may be cancelled"
    }
  ],
  "stale_view_detection": {
    "projection_version": 42,
    "last_event_id": "evt_<ulid>",
    "last_mutation_at": "2026-04-19T21:58:00.000Z"
  }
}
```

### Behavior

1. **The actionability projection is the single source of truth for dashboard affordances.**
   - The browser must fetch `/actionability` before rendering any mutation button.
   - No client-side eligibility inference. The `eligible` boolean on each action is authoritative. If `eligible: false`, the button is disabled or hidden. Period.

2. **`projection_version` is a monotonically increasing sequence.**
   - Every run-level mutation increments `projection_version`.
   - Every event (acceptance, rejection, phase transition, checkpoint, retry, cancellation) increments it.
   - The dashboard sends `If-Match: <projection_version>` on mutation requests. The server rejects with `409 Conflict` if the run's current projection version differs from the request's `If-Match` value.
   - This is the stale-view enforcement mechanism. It is not optional.

3. **Turn-level actions are projected per-turn, not per-run.**
   - A run with 5 turns may have 0, 1, or more turns with available actions.
   - Each turn entry includes only the actions currently valid for that specific turn.
   - Actions that are impossible for a turn's current status (e.g., `retry_turn` on an `accepted` turn) must never appear, not appear with `eligible: false`.

4. **Checkpoint-level actions are projected per-checkpoint.**
   - Each checkpoint entry includes the `turn_id` it originated from and the `checkpoint_sha`.
   - `restart_from_checkpoint` is available only if the checkpoint is the most recent one (you cannot restart from an intermediate checkpoint without first explicitly rolling back).
   - Future: ordered checkpoint list for rollback support. v1: only the latest checkpoint is restartable.

5. **Pending approvals are phase-gate-scoped.**
   - Each pending approval entry names the gate, the target phase, and the evaluation result.
   - The projection does not show "approve" if the gate evaluation has not yet passed.
   - If the gate passed but the operator has not approved, `eligible: true`. If the gate has not passed, the entry does not appear.

6. **Ineligible actions are omitted, not shown as disabled.**
   - The projection includes only currently valid actions. If `retry_turn` is not available because the turn status is `accepted`, the `retry_turn` action is absent from that turn's `available_actions`.
   - The browser never sees a full menu of disabled buttons. It sees exactly what can be done right now.
   - Exception: run-level actions (`cancel_run`) may appear with `eligible: false` and a reason when the run is in a terminal state, to explain why cancellation is no longer possible.

7. **The projection is read-only and audit-compatible.**
   - Fetching `/actionability` produces no side effects.
   - The projection payload is exportable as part of the portability bundle's run snapshot.
   - Every action in the projection maps 1:1 to a control-plane API endpoint. There are no projection-only actions.

8. **Event-stream subscribers receive projection invalidation signals.**
   - When the actionability projection changes (new event, mutation outcome, phase transition), the event stream sends:
   ```json
   { "type": "actionability_changed", "projection_version": 43, "run_id": "run_<ulid>" }
   ```
   - The dashboard must re-fetch `/actionability` on receiving this signal. It must not attempt to incrementally update the local projection from event data.
   - This keeps the projection server-authoritative. The event stream tells the client WHEN to refresh, not WHAT changed.

9. **The projection degrades gracefully on transient errors.**
   - If the actionability endpoint is temporarily unavailable, the dashboard must disable all mutation affordances and show a "connection lost — reconnecting" state.
   - It must not fall back to locally cached projections or inferred eligibility.
   - Re-fetch on reconnection. The projection version will catch any missed state transitions.

10. **Projection computation is protocol-evaluator-backed.**
    - Turn eligibility (`retry`, `accept`, `reject`) is computed by the same state-machine evaluators used in the CLI.
    - Checkpoint eligibility (`restart`) is computed by the same `checkpointAcceptedTurn` logic.
    - Gate approval eligibility is computed by the same gate evaluator.
    - The hosted API wraps these evaluators, not reimplements them. Parity is enforced, not aspirational.

### Error Cases

1. The browser uses locally cached run JSON to render a "Retry" button for a turn that has already been retried by another operator. Clicking it produces a stale-state error because the projection was not re-fetched.
2. The event stream misses a `projection_version` increment (network partition). The browser's projection is silently stale. Next mutation attempt hits `409 Conflict` and forces a refresh.
3. A turn transitions from `failed` → `retrying` → `dispatched` between the browser's last actionability fetch and the user's click. The `If-Match` header catches the version mismatch.
4. The checkpoint list includes an intermediate checkpoint that is not the latest. The browser renders "Restart" on it. The server rejects because only the latest checkpoint is restartable in v1.
5. A gate evaluation changes from `passed` → `not_passed` between projection fetch and approval click (e.g., a concurrent turn invalidated the gate). The `If-Match` version mismatch catches this.
6. The event stream sends `actionability_changed` but the re-fetch fails. The browser disables all mutations and shows degraded state instead of using the stale projection.

### Acceptance Tests

1. `AT-AIRM-001`: The actionability endpoint returns `pending_approvals`, `turn_actions`, `checkpoint_actions`, and `run_actions` as separate keyed arrays, each scoped to explicit identifiers (`turn_id`, `checkpoint_id`, `gate`).
2. `AT-AIRM-002`: Each action entry includes an `eligible` boolean and a `reason` string. The browser uses `eligible`, not status inference.
3. `AT-AIRM-003`: `projection_version` increments on every run-level state change. Mutation requests carry `If-Match: <version>`. Stale versions produce `409 Conflict`.
4. `AT-AIRM-004`: Ineligible turn-level actions are omitted from the projection, not shown as disabled. Only currently valid actions appear.
5. `AT-AIRM-005`: The event stream sends `actionability_changed` with the new `projection_version` when the projection changes. The dashboard must re-fetch, not incrementally patch.
6. `AT-AIRM-006`: If the actionability endpoint is unavailable, the dashboard disables all mutation affordances. No fallback to cached projections.
7. `AT-AIRM-007`: Every action in the projection maps 1:1 to a control-plane API endpoint. No projection-only actions.
8. `AT-AIRM-008`: Eligibility computation uses the same protocol evaluators as the CLI (gate evaluator, state-machine validators, checkpoint logic). No reimplementation.
9. `AT-AIRM-009`: The projection payload is exportable as part of the portability bundle. Cloud-only metadata is absent.
10. `AT-AIRM-010`: Pending approvals appear only when the gate evaluation has passed. Pre-pass gates do not produce approval entries.

### Open Questions

1. Should the actionability projection include a `urgency` or `age` field for pending approvals to support SLA dashboards, or should that be a separate analytics surface?
2. Should v2 support multi-operator conflict detection (two operators both see "approve" and both click)? The `If-Match` mechanism catches this at the mutation layer, but the projection layer could proactively mark "another operator is viewing this action" using presence signals.
3. Should the projection include historical actions (what was already done) in addition to available actions, or should historical review remain a separate read-model endpoint?
