# Dashboard Gate Actions Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-03

## Purpose

Promote the local dashboard from a passive observer to a narrow operator surface for the one mutation class that already has stable human-governed semantics: gate approval.

This slice exists because the dashboard already shows pending repo-local and coordinator gates, but the operator still has to leave the UI and run a CLI command for the approval itself. That gap is unnecessary for gate approvals and strategically weaker than the repo already claims: humans remain sovereign, but the dashboard should be able to perform explicit human approval actions locally.

This is **not** a general dashboard mutation framework.

## Interface

### New bridge endpoints

```http
GET /api/session
POST /api/actions/approve-gate
```

### `GET /api/session`

Returns a per-process dashboard session contract:

```json
{
  "session_version": "1",
  "mutation_token": "<opaque random token>",
  "capabilities": {
    "approve_gate": true
  }
}
```

### `POST /api/actions/approve-gate`

Requires:

- `Content-Type: application/json`
- `X-AgentXchain-Token: <mutation_token>`

Response on success:

```json
{
  "ok": true,
  "scope": "repo" | "coordinator",
  "gate_type": "phase_transition" | "run_completion",
  "message": "...",
  "next_action": "..."
}
```

Response on failure:

```json
{
  "ok": false,
  "error": "...",
  "code": "..."
}
```

## Behavior

### Action scope

The dashboard may approve only pending gates:

- repo-local `pending_phase_transition`
- repo-local `pending_run_completion`
- coordinator `pending_gate`

The bridge must not execute arbitrary shell commands, arbitrary CLI subcommands, or generic recovery actions.

### Gate selection order

- If repo-local state has a pending repo gate, approve that gate.
- Otherwise, if coordinator state has a pending coordinator gate, approve that gate.
- Otherwise, return `409` with `code = "no_pending_gate"`.

Repo-local gates win when both surfaces exist because repo state is the more immediate governed authority in the current repo.

### Auth boundary

- Each bridge process generates one random mutation token at startup.
- The token is readable only through same-origin `GET /api/session`.
- Mutation requests must present the exact token in `X-AgentXchain-Token`.
- Missing or incorrect token returns `403`.

This is a local anti-CSRF boundary, not a multi-user auth system.

### Execution path

- Repo-local phase approval uses `approvePhaseTransition(root, config)`.
- Repo-local completion approval uses `approveRunCompletion(root, config)`.
- Coordinator gate approval reuses the existing `before_gate` hook path and then calls `approveCoordinatorPhaseTransition()` or `approveCoordinatorCompletion()`.

The bridge must call library functions directly, not shell out to the CLI.

### UI behavior

- The Gates view shows an explicit approve button for each pending gate card.
- The existing copyable CLI command remains visible as fallback and as transparency evidence.
- The dashboard fetches the session token on load and uses it only for mutation requests.
- After a successful approval, the view refreshes and the normal file-watcher invalidation path remains authoritative.

### Out of scope

- `resume`
- `step --resume`
- `resume --role`
- arbitrary blocked-state recovery
- dashboard write support over WebSocket
- remote or multi-user authentication

## Error Cases

- Missing or malformed session token
- Missing pending gate
- Hook-blocked gate approval
- Unknown coordinator gate type
- Invalid JSON request body
- Unsupported mutation path or method

## Acceptance Tests

- `AT-DASH-ACT-001`: `GET /api/session` returns `session_version`, `mutation_token`, and `capabilities.approve_gate = true`.
- `AT-DASH-ACT-002`: `POST /api/actions/approve-gate` without token returns `403`.
- `AT-DASH-ACT-003`: repo-local phase gate approval succeeds through the bridge and clears `pending_phase_transition`.
- `AT-DASH-ACT-004`: repo-local completion gate approval succeeds through the bridge and marks the run `completed`.
- `AT-DASH-ACT-005`: coordinator gate approval succeeds through the bridge and clears `pending_gate`.
- `AT-DASH-ACT-006`: when no gate exists, approval returns `409` with `code = "no_pending_gate"`.
- `AT-DASH-ACT-007`: WebSocket messages remain read-only; mutation continues to require HTTP + token.
- `AT-DASH-ACT-008`: docs describe the local token boundary, approve-gate scope, and the fact that recovery commands still remain CLI-only.

## Open Questions

- Whether a later slice should add dashboard support for one narrow recovery action family (`step --resume`) behind the same token model.
- Whether the dashboard should surface explicit hook-block details from failed gate approvals in a richer structured response.
