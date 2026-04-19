## AgentXchain.ai Dashboard Mutation Spec

**Status:** Active
**Created:** Turn 290 — GPT 5.4
**Depends on:** `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md`, `AGENTXCHAIN_AI_CONTROL_PLANE_API_SPEC.md`, `AGENTXCHAIN_AI_EXECUTION_PLANE_SPEC.md`

### Purpose

Define the hosted dashboard mutation contract so the `.ai` UI can execute approval and recovery actions without inventing cloud-only governance behavior.

The control-plane API spec names endpoints. The managed-surface spec says dashboards may expose protocol-compatible actions. What was still missing is the UI-to-API contract: which actions the dashboard may surface, what identifiers they must send, how duplicate clicks are handled, and which actions remain out of scope. Without this spec, the dashboard becomes the easiest place to smuggle in "just this one convenience" that the protocol never approved.

### Interface

#### Supported dashboard mutations

| UI action | Endpoint | Required request fields |
|---|---|---|
| Accept turn | `POST /v1/runs/:run_id/turns/:turn_id/accept` | none beyond path ids |
| Reject turn | `POST /v1/runs/:run_id/turns/:turn_id/reject` | `reason`, optional `detail` |
| Approve phase transition | `POST /v1/runs/:run_id/approve-transition` | none beyond path id |
| Checkpoint accepted turn | `POST /v1/runs/:run_id/checkpoint` | `turn_id` |
| Restart from checkpoint | `POST /v1/runs/:run_id/restart` | `checkpoint_id` |
| Retry failed turn | `POST /v1/runs/:run_id/retry` | `turn_id` |

#### Mutation request envelope

Every dashboard mutation request must include:

- authenticated user identity from the hosted session
- `X-Idempotency-Key: <opaque uuid-or-ulid>`
- `Content-Type: application/json`

Every success response must include:

```json
{
  "ok": true,
  "action": "accept_turn",
  "run_id": "run_<ulid>",
  "turn_id": "turn_<ulid>",
  "run_status": "active",
  "phase": "qa",
  "audit_entry_id": "audit_<ulid>",
  "event_ids": ["evt_<ulid>"],
  "next_actions": [
    {
      "action": "checkpoint_turn",
      "label": "Checkpoint accepted turn"
    }
  ]
}
```

Every failure response must include:

```json
{
  "ok": false,
  "code": "stale_view",
  "message": "Turn is no longer eligible for retry.",
  "run_id": "run_<ulid>",
  "turn_id": "turn_<ulid>",
  "next_actions": []
}
```

### Behavior

1. **The dashboard is a transport surface, not a governance surface.**
   - Every hosted dashboard mutation must map 1:1 onto an existing control-plane endpoint.
   - The dashboard must not expose actions with no protocol equivalent such as `force_accept`, `skip_verification`, `advance_phase_anyway`, or `resume_latest`.

2. **The server, not the browser, decides actionability.**
   - The dashboard may render mutation controls only for actions the control plane reports as currently eligible.
   - The browser must not infer "retry is allowed because the turn looks failed" or "checkpoint the latest accepted turn" from local view state alone.

3. **Recovery actions require explicit target identity.**
   - `checkpoint` requires the exact `turn_id` of the accepted turn to checkpoint.
   - `restart` requires the exact `checkpoint_id` to restart from.
   - `retry` requires the exact `turn_id` being retried.
   - The hosted API must reject missing or ambiguous target identifiers with `400`, not silently choose the latest object.

4. **One click performs one mutation.**
   - The dashboard must not chain accept → checkpoint → retry or any other multi-step flow behind one button.
   - If a workflow wants multiple actions, the operator performs multiple explicit clicks and receives separate audit rows.

5. **Mutation delivery is HTTP-only and idempotent.**
   - Event streams, WebSockets, and SSE stay read-only.
   - The dashboard performs mutations over authenticated HTTP.
   - Duplicate requests with the same idempotency key must return the same logical result without duplicating audit entries.

6. **Mutation responses carry canonical follow-up actions.**
   - The server returns `next_actions[]` after every mutation so the dashboard can render the correct next step without inventing client-side flow logic.
   - Terminal states return `next_actions: []`.

7. **Human-sovereign approvals remain human-scoped.**
   - Only authenticated human operators with `operator` or `owner` role may invoke acceptance, rejection, phase approval, checkpoint, restart, or retry from the hosted dashboard.
   - Managed connectors and background workers cannot call these operator-facing mutation endpoints.

8. **Stale-view handling fails closed.**
   - If another operator or recovery path has already changed the run, the API returns a stale-state error and the dashboard must refresh.
   - The dashboard must not optimistically update mutation state before the server confirms the protocol outcome.

9. **Hosted dashboard scope stays narrower than "all CLI commands."**
   - Supported hosted mutations are limited to acceptance, rejection, phase approval, checkpoint, restart, and retry.
   - Arbitrary shell execution, ad hoc file editing, connector credential management, and policy mutation stay outside the run dashboard surface.

10. **Operator visibility and mutation visibility must stay aligned.**
   - Any state that renders a hosted mutation affordance must also expose the same action in run detail JSON and audit/event history.
   - Hidden mutations are banned. If the action is not representable in the exported/audited run state, it does not belong in the dashboard.

### Error Cases

1. The dashboard infers "latest accepted turn" and checkpoints the wrong turn because the browser state was stale.
2. Double-clicking a mutation creates duplicate audit rows because the API lacks idempotency.
3. WebSocket or SSE mutation shortcuts bypass the normal audit/auth path.
4. The UI exposes `retry` for `rejected` turns even though the protocol only allows retry for the eligible failed states.
5. The dashboard invents compound actions like `accept_and_checkpoint` that do not exist in the shared protocol contract.
6. Background workers are allowed to hit operator mutation endpoints, collapsing human-sovereign approvals.
7. Mutation success responses omit `next_actions`, forcing the browser to reconstruct workflow logic.
8. A stale dashboard view silently mutates the current run head instead of failing closed with a refresh-required error.

### Acceptance Tests

1. `AT-AIDM-001`: The spec maps hosted dashboard mutations only to existing control-plane endpoints for accept, reject, approve-transition, checkpoint, restart, and retry.
2. `AT-AIDM-002`: `checkpoint`, `restart`, and `retry` require explicit `turn_id` or `checkpoint_id`; the server does not infer "latest."
3. `AT-AIDM-003`: The spec requires `X-Idempotency-Key` on every mutation and forbids duplicate audit entries for duplicate submissions.
4. `AT-AIDM-004`: Event streams remain read-only; hosted dashboard mutations use authenticated HTTP only.
5. `AT-AIDM-005`: The dashboard must not expose cloud-only governance actions such as `force_accept`, `skip_verification`, or arbitrary `resume_latest`.
6. `AT-AIDM-006`: Mutation responses include canonical `next_actions[]` so the browser does not reconstruct workflow logic.
7. `AT-AIDM-007`: Hosted dashboard mutation authority is limited to human `operator` and `owner` actors; connectors/workers cannot use these endpoints.
8. `AT-AIDM-008`: The dashboard fails closed on stale state and refreshes instead of mutating based on inferred current eligibility.

### Open Questions

1. Should later hosted dashboards support a guided multi-step recovery wizard that still emits separate underlying protocol mutations, or stay strictly single-action forever?
2. Should `reject turn` require a structured reason enum in v1, or is free-text + audit trail sufficient until rejection analytics become productized?
