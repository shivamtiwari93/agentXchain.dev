# Blocked State Interface — v1 Spec

> The operator recovery contract defines what blocked states exist. This spec defines how the CLI exposes them consistently.

---

## Purpose

When a governed run pauses or rejects operator input, the CLI must tell the operator exactly what happened and what to do next. The goal is to make blocked-state recovery testable and consistent across `status`, `step`, `accept-turn`, and approval commands.

This spec does not change the underlying protocol state machine. It defines the recovery descriptor that command surfaces must render from that state machine.

---

## Interface/Schema

Every blocked or rejected governed CLI surface SHOULD be reducible to this descriptor:

```ts
type RecoveryDescriptor = {
  typed_reason:
    | "pending_phase_transition"
    | "pending_run_completion"
    | "needs_human"
    | "operator_escalation"
    | "retries_exhausted"
    | "active_turn_exists"
    | "clean_baseline_violation"
    | "schema_error"
    | "artifact_error"
    | "verification_error"
    | "protocol_error"
    | "dispatch_error"
    | "unknown_block";
  owner: "human" | "orchestrator" | "agent";
  recovery_action: string;
  turn_retained: boolean;
  detail?: string | null;
};
```

CLI rendering requirement:

```text
Blocked: {typed_reason}
Owner:   {owner}
Action:  {recovery_action}
Turn:    {retained|cleared}
```

Exact whitespace and box-drawing are non-normative. The four fields are normative.

---

## Behavior

### 1. `status`

`status` is the canonical read surface for paused runs. It MUST render a recovery descriptor when any of the following are true:

- `state.pending_phase_transition` exists
- `state.pending_run_completion` exists
- `state.blocked_on` starts with `human:`
- `state.blocked_on` starts with `escalation:`

Mappings:

| State shape | typed_reason | owner | recovery_action | turn_retained |
|-------------|--------------|-------|-----------------|---------------|
| `pending_phase_transition` | `pending_phase_transition` | `human` | `agentxchain approve-transition` | `false` |
| `pending_run_completion` | `pending_run_completion` | `human` | `agentxchain approve-completion` | `false` |
| `blocked_on = human:*` | `needs_human` | `human` | `Resolve the stated issue, then run agentxchain step --resume` | `false` when `current_turn` is null, otherwise `true` |
| `blocked_on = escalation:operator:*` | `operator_escalation` | `human` | `Resolve the escalation, then run agentxchain step` or `agentxchain step --resume` depending on retained turn | `true` when a turn is retained, otherwise `false` |
| `blocked_on = escalation:*` | `retries_exhausted` | `human` | `Resolve the escalation, then run agentxchain step --resume` | `true` if `current_turn` is still present |
| `blocked_on = dispatch:*` | `dispatch_error` | `human` | `Resolve the dispatch issue, then run agentxchain step --resume` | `true` |

### 2. `step`

`step` is the canonical write surface for assignment and dispatch failures.

Mappings:

| Condition | typed_reason | owner | recovery_action | turn_retained |
|-----------|--------------|-------|-----------------|---------------|
| Active turn exists and `--resume` not supplied | `active_turn_exists` | `human` | `agentxchain step --resume` | `true` |
| Assignment blocked by dirty authoritative/proposed tree | `clean_baseline_violation` | `human` | `git commit ...` or `git stash`, then `agentxchain step` | `false` |
| Adapter dispatch fails before staged result is accepted | `dispatch_error` | `human` | `agentxchain step --resume` or manual staging + `accept-turn` | `true` |

### 3. `accept-turn`

When staged turn validation fails, `accept-turn` MUST expose both the validation class and the recovery action.

Mappings:

| Validation stage | typed_reason | owner | recovery_action | turn_retained |
|------------------|--------------|-------|-----------------|---------------|
| Schema | `schema_error` | `human` or `agent` | Fix staged result and rerun `agentxchain accept-turn`, or reject with `agentxchain reject-turn --reason "..."` | `true` |
| Artifact observation | `artifact_error` | `human` or `agent` | Same as above | `true` |
| Verification | `verification_error` | `human` or `agent` | Same as above | `true` |
| Protocol | `protocol_error` | `human` | Fix root cause before retry/reject | `true` |

### 4. Escalation Semantics

In the current implementation, retry exhaustion blocks the run but preserves the failed `current_turn` record for auditability and redispatch context.

That means:

- escalation is not the same as assignment clearing
- the recovery action is `agentxchain step --resume`, not forced reassignment to `eng_director`
- role escalation remains a policy choice for a later spec revision, not an implemented invariant

### 5. Approval Commands

`approve-transition` and `approve-completion` MUST remain strict in v1:

- They succeed only when the matching pending object exists and `state.status === "paused"`.
- They do not attempt best-effort idempotency.

Rationale: with no command argument identifying the prior approval request, the CLI cannot distinguish "already approved" from "nothing pending" safely.

---

## Error Cases

- If the command can identify a blocked condition but not derive a typed reason, it MUST render `typed_reason: "unknown_block"` and preserve the raw detail string.
- If `status` sees `blocked_on` without a recognized prefix, it SHOULD render the raw value as `detail`.
- If a paused run has both `pending_phase_transition` and `pending_run_completion`, `pending_run_completion` wins. The run is closer to terminal state.

---

## Acceptance Tests

1. `status` with `pending_phase_transition` shows `agentxchain approve-transition` as the recovery action.
2. `status` with `pending_run_completion` shows `agentxchain approve-completion` as the recovery action.
3. `status` with `blocked_on = "human:scope clarification needed"` shows `typed_reason = needs_human` and `agentxchain step --resume`.
4. `status` with `blocked_on = "escalation:retries-exhausted:dev"` shows `typed_reason = retries_exhausted` and `agentxchain step --resume`.
5. `status` with `blocked_on = "escalation:operator:scope-contradiction"` shows `typed_reason = operator_escalation`.
6. `step` with an already assigned turn suggests `agentxchain step --resume`.
7. `step` on a dirty authoritative tree tells the operator to commit or stash before retrying.
8. `step` with missing `auth_env` on an `api_proxy` runtime names the missing environment variable and suggests `agentxchain step --resume`.
9. `accept-turn` with an invalid staged result prints both the failed validation stage and the recovery commands.
10. `status` with `blocked_on = "dispatch:auth_failure"` shows `typed_reason = dispatch_error` and `agentxchain step --resume`.

---

## Open Questions

1. Should v1.1 persist the derived recovery descriptor to `.agentxchain/blocked.json` for dashboards and editor integrations?
2. Should a future version convert `retries_exhausted` into an explicit role handoff (`eng_director`, `human`, or named override) instead of preserving the failed turn for redispatch?
