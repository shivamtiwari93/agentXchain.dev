# Runtime-Aware Blocked Guidance Spec

## Purpose

Stop blocked-state recovery from collapsing distinct runtime/config failures into the same vague retry advice. Operators need to know when the real blocker is:

- an invalid runtime/authority binding
- a remote review-only ownership dead-end
- a proposal-owned artifact that still needs `proposal apply`
- an MCP/tool-defined path that AgentXchain cannot prove statically

This slice extends the blocked-state descriptor so `status` and `report` can expose the same runtime-aware guidance.

## Interface

`deriveRecoveryDescriptor(state, config)` remains the canonical blocked-state reader in `cli/src/lib/blocked-state.js`.

When runtime-aware gate guidance is available, the descriptor now includes:

```ts
type RuntimeGuidance = {
  code:
    | "invalid_binding"
    | "review_only_remote_dead_end"
    | "proposal_apply_required"
    | "tool_defined_proof_not_strong_enough";
  phase: string;
  gate_id: string;
  role_id: string;
  artifact_path: string;
  command: string;
  reason: string;
};
```

And:

```ts
type RecoveryDescriptor = {
  typed_reason: string;
  owner: string;
  recovery_action: string;
  turn_retained: boolean;
  detail?: string | null;
  runtime_guidance?: RuntimeGuidance[];
};
```

`deriveGovernedRunNextActions(state, config)` is the canonical operator-action surface for governed run reports and `status --json`.

## Behavior

### 1. Runtime guidance source

Runtime guidance derives from the current or most recent gate failure only when:

- a governed config is available
- `state.last_gate_failure` identifies a gate and phase
- the gate failure reports `missing_files[]`

This slice is intentionally narrow. It does not invent runtime guidance for unrelated blocked reasons like timeout or operator escalation.

### 2. Classification

For each missing required artifact, resolve the owning role (`owned_by` or phase `entry_role`) and classify the owner's runtime contract:

- `invalid_binding`
  - any role/runtime combination whose effective write path or workflow ownership is `invalid`
  - operator action: fix `agentxchain.json`, then rerun `agentxchain validate`
- `review_only_remote_dead_end`
  - remote review-only roles that can produce review artifacts but cannot satisfy workflow ownership
  - operator action: fix `agentxchain.json`, then rerun `agentxchain validate`
- `proposal_apply_required`
  - remote proposed-authoring roles whose required files exist only behind proposal materialization
  - operator action: `agentxchain proposal apply <turn_id>` when the failed request turn is known, otherwise `agentxchain proposal list`
- `tool_defined_proof_not_strong_enough`
  - MCP/tool-defined ownership paths where AgentXchain cannot prove the local file-write contract statically
  - operator action: inspect the configured role/tool contract with `agentxchain role show <role_id>`

### 3. Status surface

`agentxchain status` must render runtime guidance whenever it exists, even if the run is still `active` and the gate failure is advisory rather than blocked.

The guidance must include:

- classification code
- command/action
- artifact/role explanation

### 4. Report surface

`agentxchain report` for `subject.kind = governed_run` must:

- add `subject.run.next_actions`
- include runtime guidance entries there before generic blocked-state resume actions
- include `runtime_guidance[]` inside `subject.run.recovery_summary` when a recovery summary exists

### 5. Command ordering

If both runtime guidance and a generic blocked-state recovery action exist:

1. runtime guidance goes first
2. generic recovery (`resume`, `step --resume`, approval, etc.) comes after the operator resolves the runtime blocker

## Error Cases

- No `missing_files[]`: do not guess. Return no runtime guidance.
- Missing owner role: do not invent a runtime explanation.
- Missing failed turn id for `proposal_apply_required`: fall back to `agentxchain proposal list`, not a fake `proposal apply`.
- Multiple missing artifacts may produce multiple guidance rows; dedupe identical command/reason pairs.

## Acceptance Tests

1. `status` for a proposed remote owner with a missing gate artifact shows `proposal_apply_required` and `agentxchain proposal apply <turn_id>`.
2. `status` for an invalid `review_only + local_cli` owner shows `invalid_binding` and a config-fix action instead of `step --resume`.
3. `status` for an MCP-owned missing artifact shows `tool_defined_proof_not_strong_enough` and `agentxchain role show <role>`.
4. `report --format json` for a governed run includes `subject.run.next_actions`.
5. `report --format json` includes runtime-guidance metadata inside `subject.run.recovery_summary` when the run is blocked and guidance exists.
6. Recovery docs mention the runtime-guidance extension and all four runtime-guidance codes.

## Open Questions

- None for this slice. Dashboard reuse can consume the same helper later.
