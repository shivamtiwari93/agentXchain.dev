# Delegation Chains — Spec

## Purpose

Enable a role to delegate sub-tasks to other roles within a governed run. A delegating role (e.g., `eng_director`) can request that specific work be done by another role (e.g., `dev`) before the run continues. This creates a governed chain of authority: the delegating role defines the charter, the delegate executes it, and the delegating role reviews the result.

This differentiates AgentXchain from flat multi-agent systems where all roles are peers. Delegation chains enable hierarchical authority, task decomposition, and review-after-delegation — core capabilities for governed software delivery at scale.

## Interface

### Turn Result Extension

A new optional `delegations` array in `turn-result.schema.json`:

```json
{
  "delegations": [
    {
      "id": "del-001",
      "to_role": "dev",
      "charter": "Implement the auth middleware refactor",
      "acceptance_contract": [
        "All auth tests pass",
        "No breaking changes to existing endpoints"
      ]
    }
  ]
}
```

**Fields:**
- `id`: string, pattern `^del-\d{3}$`, unique within the turn
- `to_role`: string, must be a valid role in `config.roles` and routing-legal for the current phase
- `charter`: string, min 1 char — the scope of delegated work
- `acceptance_contract`: array of strings — what the delegate must achieve

**Constraints:**
- A role cannot delegate to itself
- `to_role` must exist in `config.roles`
- `to_role` must be in `allowed_next_roles` for the current phase
- Maximum 5 delegations per turn (prevent delegation spam)
- `delegations` is mutually exclusive with `run_completion_request: true`
- A delegation review turn cannot itself contain delegations (no recursive delegation in v1)

### State Extension

New fields in `state.json`:

```json
{
  "delegation_queue": [
    {
      "delegation_id": "del-001",
      "parent_turn_id": "turn_0003",
      "parent_role": "eng_director",
      "to_role": "dev",
      "charter": "Implement the auth middleware refactor",
      "acceptance_contract": ["All auth tests pass"],
      "status": "pending",
      "child_turn_id": null,
      "created_at": "2026-04-14T05:00:00Z"
    }
  ],
  "pending_delegation_review": null
}
```

**`delegation_queue`** tracks delegated sub-tasks. Statuses:
- `pending` — not yet assigned
- `active` — child turn is running
- `completed` — child turn was accepted
- `failed` — child turn was rejected or run is blocked

**`pending_delegation_review`** is set when all delegations from a parent turn are completed:

```json
{
  "parent_turn_id": "turn_0003",
  "parent_role": "eng_director",
  "delegation_results": [
    {
      "delegation_id": "del-001",
      "child_turn_id": "turn_0004",
      "to_role": "dev",
      "charter": "...",
      "summary": "Implemented auth middleware...",
      "status": "completed",
      "files_changed": ["src/auth.js"],
      "verification": { "status": "pass" }
    }
  ]
}
```

## Behavior

### After Accepting a Turn with Delegations

1. The turn is accepted normally (all existing validation applies)
2. Each delegation is added to `delegation_queue` with status `pending`
3. `next_recommended_role` is set to the first pending delegation's `to_role` (overrides `proposed_next_role`)
4. `pending_delegation_review` is not set yet

### Role Resolution with Active Delegation Queue

When `delegation_queue` has pending items, role resolution changes:

1. **Priority 1**: If there are `pending` delegations, the next role is the first pending delegation's `to_role`
2. **Priority 2**: Normal `next_recommended_role` / `entry_role` / first-role fallback

An explicit `--role` override still works but emits a warning if it skips a pending delegation.

### Dispatch Bundle for Delegated Turns

When a turn is dispatched for a delegated sub-task, the dispatch bundle includes a `delegation_context` section in CONTEXT.md:

```markdown
## Delegation Context

You are executing a delegated sub-task.

- **Delegated by:** eng_director (turn turn_0003)
- **Charter:** Implement the auth middleware refactor
- **Acceptance contract:**
  - All auth tests pass
  - No breaking changes to existing endpoints

Focus exclusively on the charter above. Do not expand scope beyond the delegation.
```

The ASSIGNMENT.json also includes:

```json
{
  "delegation_context": {
    "delegation_id": "del-001",
    "parent_turn_id": "turn_0003",
    "parent_role": "eng_director",
    "charter": "...",
    "acceptance_contract": ["..."]
  }
}
```

### After Accepting a Delegated Turn

1. The corresponding `delegation_queue` entry moves to `completed`
2. The child turn's summary, files_changed, and verification are captured
3. If all delegations from the same parent are now `completed`:
   - `pending_delegation_review` is set with the aggregated results
   - `next_recommended_role` is set to the `parent_role`
   - The delegation queue entries for this parent are cleared
4. If some delegations are still `pending`:
   - `next_recommended_role` is set to the next pending delegation's `to_role`

### Delegation Review Turn

When `pending_delegation_review` is set, the parent role gets a review turn. The dispatch bundle includes:

```markdown
## Delegation Review

Your delegated sub-tasks have been completed. Review the results below.

### del-001 → dev
- **Charter:** Implement the auth middleware refactor
- **Summary:** Implemented auth middleware with JWT validation...
- **Files changed:** src/auth.js, src/middleware.js
- **Verification:** pass

Evaluate whether each delegation met its acceptance contract.
Your turn result should assess the delegation outcomes and decide next steps.
```

The ASSIGNMENT.json includes:

```json
{
  "delegation_review": {
    "parent_turn_id": "turn_0003",
    "results": [...]
  }
}
```

After the review turn is accepted:
- `pending_delegation_review` is cleared
- Normal run flow resumes

### Delegation Rejection

If a delegated turn is rejected (validation failure, policy violation, etc.):
- The delegation_queue entry moves to `failed`
- The run may retry (normal retry logic applies)
- If max retries exhausted, the delegation is marked `failed` and the delegation review includes the failure

### No Recursive Delegation (v1)

A delegation review turn cannot itself contain delegations. If it does, validation rejects with error: "Delegation review turns cannot contain further delegations."

This restriction will be lifted in a future version if hierarchical delegation proves valuable.

## Error Cases

1. **Unknown `to_role`**: validation error — "Delegation to_role 'xyz' is not a defined role"
2. **Self-delegation**: validation error — "Role 'dev' cannot delegate to itself"
3. **Routing-illegal role**: validation error — "Role 'xyz' is not in allowed_next_roles for phase 'planning'"
4. **Too many delegations**: validation error — "Maximum 5 delegations per turn (got N)"
5. **Delegation with run_completion**: validation error — "Delegations are mutually exclusive with run_completion_request"
6. **Recursive delegation**: validation error — "Delegation review turns cannot contain further delegations"
7. **Duplicate delegation IDs**: validation error — "Duplicate delegation id 'del-001'"

## Acceptance Tests

- AT-DEL-001: Turn result with `delegations` is accepted and populates `delegation_queue`
- AT-DEL-002: Role resolution returns delegation queue's `to_role` when pending delegations exist
- AT-DEL-003: Delegated turn receives `delegation_context` in dispatch bundle
- AT-DEL-004: Completing all delegations sets `pending_delegation_review` and recommends parent role
- AT-DEL-005: Delegation review turn receives delegation results in dispatch bundle
- AT-DEL-006: Accepting delegation review clears `pending_delegation_review`
- AT-DEL-007: Self-delegation is rejected
- AT-DEL-008: Delegation to unknown role is rejected
- AT-DEL-009: Delegation with run_completion_request is rejected
- AT-DEL-010: More than 5 delegations per turn is rejected
- AT-DEL-011: Delegation review turn with delegations is rejected (no recursion)

## Open Questions

1. Should delegation chains interact with phase transitions? (v1: no — delegations must complete within the current phase)
2. Should parallel delegations be allowed? (v1: sequential only — one delegation at a time)
3. Should delegated turns have a narrower budget reservation? (v1: no — uses normal budget allocation)
