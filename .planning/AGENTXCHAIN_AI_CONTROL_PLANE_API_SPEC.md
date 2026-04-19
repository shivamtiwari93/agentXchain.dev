## AgentXchain.ai Control Plane API Spec

**Status:** Active
**Created:** Turn 285 — Claude Opus 4.6
**Depends on:** `AGENTXCHAIN_AI_MANAGED_SURFACE_SPEC.md`

### Purpose

Define the REST API contract for the `.ai` control plane: the tenancy objects (organizations, workspaces, projects), governed run lifecycle, approval actions, and audit/event query surfaces.

This spec exists so the first `.ai` implementation has a binding contract instead of ad-hoc endpoint invention. Every endpoint here must produce protocol-compatible state — no cloud-only governance semantics.

### Authentication and Authorization

The managed surface spec (`DEC-AI-MANAGED-SURFACE-ARCH-001`) requires human-sovereign approvals and explicit audit attribution. This forces an auth model:

1. **Authentication:** API key or OAuth 2.0 bearer token. Every request carries an authenticated identity.
2. **Authorization:** RBAC scoped at workspace level. Three built-in roles:
   - `owner` — full control, including org/workspace lifecycle
   - `operator` — run lifecycle (create, approve, recover), read all
   - `viewer` — read-only
3. **Audit attribution:** Every mutating action records `actor_id`, `actor_role`, and `timestamp` in an append-only audit log. The audit log is exportable.
4. **Agent identity:** Managed connectors authenticate with workspace-scoped API keys. Agent actions are attributed to the connector identity, not the human who configured it.

### API Objects

#### Organization

```json
{
  "id": "org_<ulid>",
  "name": "string",
  "created_at": "ISO-8601",
  "owner_id": "user_<ulid>"
}
```

- One organization per billing entity.
- Organizations contain workspaces.
- Org-level settings: default connector credentials, notification routing, policy templates.

#### Workspace

```json
{
  "id": "ws_<ulid>",
  "org_id": "org_<ulid>",
  "name": "string",
  "created_at": "ISO-8601",
  "policy": {
    "approval_mode": "manual | auto_with_gate",
    "max_concurrent_runs": "number",
    "connector_credentials": "workspace-scoped credential references"
  }
}
```

- Workspaces scope governed projects, runs, connectors, and approval policies.
- Workspace-level settings override org defaults.
- Project-local credential overrides are allowed but workspace admins can audit them (`Open Question 3` from the managed surface spec — answered: yes, with audit visibility).

#### Project

```json
{
  "id": "proj_<ulid>",
  "ws_id": "ws_<ulid>",
  "name": "string",
  "repo_url": "string | null",
  "governance_config": "agentxchain.json equivalent",
  "created_at": "ISO-8601",
  "protocol_version": 7
}
```

- A project maps to a governed repository.
- `governance_config` uses the same schema as `agentxchain.json` — no cloud-only config fields.
- `protocol_version` must match the shared protocol semantics from `.dev`.

#### Run

```json
{
  "id": "run_<ulid>",
  "proj_id": "proj_<ulid>",
  "phase": "planning | implementation | qa | release",
  "status": "active | paused | completed | failed | cancelled",
  "vision": "string",
  "turns": ["turn_<ulid>"],
  "gates": { "gate_name": { "status": "pending | passed | failed", "evidence": {} } },
  "decision_ledger": ["DEC-*"],
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

- Runs are the primary governed execution object.
- Run state machine matches the `.dev` CLI state machine exactly — same phases, same gates, same transitions.
- `decision_ledger` is append-only. No cloud-only decisions.

### API Endpoints

#### Tenancy

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/orgs` | Create organization |
| GET | `/v1/orgs/:org_id` | Get organization |
| POST | `/v1/orgs/:org_id/workspaces` | Create workspace |
| GET | `/v1/orgs/:org_id/workspaces` | List workspaces |
| GET | `/v1/workspaces/:ws_id` | Get workspace |
| PATCH | `/v1/workspaces/:ws_id` | Update workspace policy |
| POST | `/v1/workspaces/:ws_id/projects` | Create project |
| GET | `/v1/workspaces/:ws_id/projects` | List projects |
| GET | `/v1/projects/:proj_id` | Get project |

#### Run Lifecycle

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/projects/:proj_id/runs` | Create governed run |
| GET | `/v1/projects/:proj_id/runs` | List runs (paginated, filterable) |
| GET | `/v1/runs/:run_id` | Get run state |
| GET | `/v1/runs/:run_id/turns` | List turns |
| GET | `/v1/runs/:run_id/turns/:turn_id` | Get turn detail |
| GET | `/v1/runs/:run_id/decisions` | Get decision ledger |
| GET | `/v1/runs/:run_id/gates` | Get gate states |
| POST | `/v1/runs/:run_id/cancel` | Cancel run |

#### Approvals and Recovery

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/runs/:run_id/approve-transition` | Approve phase transition |
| POST | `/v1/runs/:run_id/turns/:turn_id/accept` | Accept turn |
| POST | `/v1/runs/:run_id/turns/:turn_id/reject` | Reject turn |
| POST | `/v1/runs/:run_id/checkpoint` | Checkpoint a specific accepted turn (`{"turn_id":"turn_<ulid>"}` required) |
| POST | `/v1/runs/:run_id/restart` | Restart from a specific checkpoint (`{"checkpoint_id":"ckpt_<ulid>"}` required) |
| POST | `/v1/runs/:run_id/retry` | Retry a specific failed or failed_acceptance turn (`{"turn_id":"turn_<ulid>"}` required) |

- Every approval/recovery endpoint produces the same state transitions as the equivalent CLI command.
- Every mutation is recorded in the audit log with actor attribution.
- `approve-transition` requires `operator` or `owner` role.
- Dashboard and API clients must pass explicit target identifiers for checkpoint/restart/retry actions instead of asking the server to infer "latest" from a stale view.

#### Audit and Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/runs/:run_id/events` | Stream or paginate run events |
| GET | `/v1/workspaces/:ws_id/audit` | Workspace audit log (paginated) |
| GET | `/v1/runs/:run_id/export` | Export run as repo-native artifact bundle |
| POST | `/v1/projects/:proj_id/import` | Import repo-native run state |

- `export` produces a bundle compatible with the `.dev` `agentxchain export` command.
- `import` accepts the same bundle format.
- This is the portability boundary: `.dev` ↔ `.ai` round-trip without lossy transforms.

### Behavior

1. **Protocol parity is enforced, not assumed.** Every run lifecycle endpoint calls the same state-machine evaluator that the CLI uses. The control plane is a transport wrapper around protocol logic, not a reimplementation.
2. **No cloud-only governance mutations.** If an action cannot be expressed as a protocol-level operation (turn acceptance, gate transition, phase approval, checkpoint, restart, retry), it does not belong in the API.
3. **Cloud-only metadata is presentation-tier only.** Allowed cloud-only fields: `display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state`. These fields are stripped on export. They never affect turn acceptance, gate evaluation, or decision ledger outcomes.
4. **Pagination uses cursor-based pagination.** `?cursor=<opaque>&limit=<n>`. No offset pagination — it's unreliable with append-only event streams.
5. **Webhook delivery for run events.** `POST /v1/workspaces/:ws_id/webhooks` registers webhook URLs. Events are delivered at-least-once with idempotency keys. Webhook payloads use the same event schema as `.dev` `events.jsonl`.

### Error Cases

1. An API endpoint modifies governance state in a way that the CLI's state machine would reject.
2. Cloud-only metadata bleeds into the decision ledger or gate evaluator.
3. Export produces a bundle that the `.dev` CLI cannot import.
4. Import silently drops protocol-level state that has no cloud analogue.
5. An approval action succeeds on the API but produces a different outcome than the equivalent CLI command with the same inputs.
6. Webhook payloads use a different event schema than `events.jsonl`.
7. Agent connector actions are attributed to the configuring human instead of the agent identity.

### Acceptance Tests

- `AT-CP-001`: Every run lifecycle API endpoint (create, accept, reject, approve-transition, checkpoint, restart, retry, cancel) produces the same state transitions as the equivalent CLI command.
- `AT-CP-002`: Cloud-only metadata fields (`display_name`, `notification_preferences`, `dashboard_layout`, `search_index_state`) are stripped from export bundles.
- `AT-CP-003`: Export → import round-trip between `.ai` API and `.dev` CLI produces identical protocol state (phases, gates, decisions, turns, artifacts).
- `AT-CP-004`: Every mutating API call records `actor_id`, `actor_role`, and `timestamp` in the workspace audit log.
- `AT-CP-005`: Workspace RBAC enforcement — `viewer` cannot approve turns, `operator` cannot delete workspaces.
- `AT-CP-006`: Webhook payloads match the `.dev` event schema.
- `AT-CP-007`: Managed connector actions are attributed to the connector identity, not the human who registered the connector.
- `AT-CP-008`: Pagination returns consistent results across concurrent appends (cursor stability).

### Open Questions

1. Should the first implementation use the existing Node.js codebase (sharing the state-machine evaluators directly) or a separate service that calls the CLI as a subprocess? Direct sharing is safer for protocol parity; separate service is better for scale isolation.
2. Rate limiting: per-workspace or per-API-key? Per-workspace is simpler; per-key allows different connector tiers.
3. Should long-running operations (run creation with immediate dispatch) be synchronous or async with polling? Async is more resilient but adds client complexity.
