# Policy Engine Spec

## Purpose

Provide a declarative, config-driven policy rules system that evaluates governance constraints on every turn during acceptance. Policies enforce operational guardrails beyond what gates (phase-exit checks) and hooks (external commands) cover.

Gates evaluate at phase boundaries. Hooks run external commands. **Policies evaluate built-in governance rules on every accepted turn.**

## Interface

### Config Surface

New top-level `policies` array in `agentxchain.json`:

```json
{
  "policies": [
    {
      "id": "phase-turn-cap",
      "rule": "max_turns_per_phase",
      "params": { "limit": 10 },
      "action": "block"
    },
    {
      "id": "budget-guard",
      "rule": "max_cost_per_turn",
      "params": { "limit_usd": 5.00 },
      "action": "warn"
    },
    {
      "id": "no-role-monopoly",
      "rule": "max_consecutive_same_role",
      "params": { "limit": 3 },
      "action": "block"
    },
    {
      "id": "total-turn-cap",
      "rule": "max_total_turns",
      "params": { "limit": 50 },
      "action": "escalate"
    }
  ]
}
```

### Policy Schema

Each policy object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique policy identifier (kebab-case) |
| `rule` | string | yes | Built-in rule identifier |
| `params` | object | depends on rule | Rule-specific parameters |
| `action` | `"block"` \| `"warn"` \| `"escalate"` | yes | What happens on violation |
| `message` | string | no | Custom violation message (overrides default) |
| `scope` | object | no | Optional scoping (phases, roles) |

### Scope (optional)

```json
{
  "scope": {
    "phases": ["implementation", "qa"],
    "roles": ["dev", "qa_engineer"]
  }
}
```

If `scope` is omitted, the policy applies to all phases and all roles.

## Built-in Rules

### `max_turns_per_phase`

Limits the number of accepted turns within any single phase.

- **params**: `{ "limit": number }` (required, >= 1)
- **Evaluation**: Count accepted history entries where `entry.phase === currentPhase`. If count >= limit, trigger.
- **Default message**: `Policy "${id}": phase "${phase}" has reached ${count}/${limit} accepted turns`

### `max_total_turns`

Limits total accepted turns across all phases in a run.

- **params**: `{ "limit": number }` (required, >= 1)
- **Evaluation**: Count all accepted history entries. If count >= limit, trigger.
- **Default message**: `Policy "${id}": run has reached ${count}/${limit} total accepted turns`

### `max_consecutive_same_role`

Prevents a single role from monopolizing consecutive turns.

- **params**: `{ "limit": number }` (required, >= 1)
- **Evaluation**: Count consecutive tail entries in history with the same role as the current turn, then add the current turn. If the resulting streak would exceed `limit`, trigger.
- **Default message**: `Policy "${id}": role "${role}" has ${consecutive} consecutive turns (limit: ${limit})`

### `max_cost_per_turn`

Guards per-turn cost based on the turn result's cost metadata.

- **params**: `{ "limit_usd": number }` (required, > 0)
- **Evaluation**: Read `turnResult.cost?.usd`. If absent, fall back to legacy `turnResult.cost?.total_usd` for compatibility. If present and > limit_usd, trigger.
- **Default message**: `Policy "${id}": turn cost $${cost} exceeds limit $${limit_usd}`

### `require_status`

Requires turns to have specific status values.

- **params**: `{ "allowed": string[] }` (required, non-empty subset of valid turn statuses: `completed`, `blocked`, `needs_human`, `failed`)
- **Evaluation**: If `turnResult.status` is not in `allowed`, trigger.
- **Default message**: `Policy "${id}": status "${status}" is not in allowed set [${allowed}]`

## Behavior

### Actions

| Action | Effect |
|--------|--------|
| `block` | Reject the turn. Return `{ ok: false, error_code: 'policy_violation' }`. Turn stays staged. |
| `warn` | Accept the turn but include policy warnings in the acceptance result and ledger. |
| `escalate` | Block the run with `blocked_on: "policy:${policy_id}"`. Turn stays staged. Recovery descriptor persisted with `typed_reason: "policy_escalation"`. |

### Evaluation Order

1. All policies evaluate in declaration order.
2. All violations are collected (no short-circuit).
3. If any `block` violation exists → turn rejected.
4. If any `escalate` violation exists (and no block) → run blocked with a persisted recovery descriptor.
5. Remaining `warn` violations are returned as warnings.

### Integration Point

Policies evaluate in `_acceptGovernedTurnLocked()` after validation succeeds and after `after_validation` hooks, but before conflict detection and state commit. This is the same position where the turn result is known-valid but not yet committed.

```
before_validation hooks → validation → after_validation hooks
  → ** POLICY EVALUATION ** ← here
  → conflict detection → before_acceptance hooks → state commit
```

## Error Cases

- Unknown `rule` in policy → config validation error at load time (not runtime)
- Missing required `params` field → config validation error at load time
- `params.limit` is 0 or negative → config validation error
- `require_status.params.allowed` contains an unknown turn status → config validation error
- `scope.phases` references unknown phase → config validation warning (policy silently skips)
- Duplicate `id` → config validation error

## Acceptance Tests

- AT-POL-001: `max_turns_per_phase` blocks when phase turn count >= limit
- AT-POL-002: `max_turns_per_phase` passes when count < limit
- AT-POL-003: `max_total_turns` blocks when total >= limit
- AT-POL-004: `max_consecutive_same_role` blocks when the resulting streak would exceed the limit
- AT-POL-005: `max_consecutive_same_role` passes when a different role intervened
- AT-POL-006: `max_cost_per_turn` warns when cost exceeds limit
- AT-POL-007: `max_cost_per_turn` passes when cost is under limit or absent
- AT-POL-008: `require_status` blocks disallowed statuses
- AT-POL-009: `action: "escalate"` blocks the run instead of rejecting
- AT-POL-010: `action: "warn"` accepts the turn with warnings
- AT-POL-011: Scoped policies skip when phase/role is out of scope
- AT-POL-012: Multiple violations collected (no short-circuit)
- AT-POL-013: Unknown rule rejected at config validation
- AT-POL-014: Config with empty policies array is valid (no-op)
- AT-POL-015: Policies normalize to empty array when omitted from config
- AT-POL-016: Retained `manual` policy escalations recommend `agentxchain resume`
- AT-POL-017: Retained non-manual policy escalations recommend `agentxchain step --resume`
- AT-POL-018: `max_cost_per_turn` reads `cost.usd` and falls back to legacy `cost.total_usd`

## Recovery

When a policy with `action: "escalate"` fires, the run enters `blocked` state with:

- `blocked_on: "policy:${policy_id}"`
- `blocked_reason.category: "policy_escalation"`
- `blocked_reason.recovery.typed_reason: "policy_escalation"`
- `blocked_reason.recovery.recovery_action`: runtime-aware actionable command
  - retained `manual` turn: `agentxchain resume`
  - retained non-manual turn: `agentxchain step --resume`
  - no retained turn: `agentxchain resume`

The `deriveRecoveryDescriptor()` function in `blocked-state.js` recognizes the `policy:` prefix and produces a `policy_escalation` typed reason. This is a first-class recovery type, not `unknown_block`.

Operator recovery path:
1. Read the policy violation detail in `agentxchain status`
2. Resolve the condition (e.g., increase turn cap in `agentxchain.json`, change routing to vary roles)
3. Run the surfaced command (`agentxchain resume` for retained `manual` turns or cleared turns; `agentxchain step --resume` for retained non-manual turns)

## Open Questions

None. This is a self-contained extension of the existing governance model.
