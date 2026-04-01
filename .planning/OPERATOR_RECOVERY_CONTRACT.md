# Operator Recovery Contract — v1 Spec

> Every blocked state must tell the operator: what happened, who owns it, and exactly how to unblock.

---

## Purpose

The governed protocol pauses the run in several well-defined situations. Each pause is intentional — it represents a quality gate, a validation failure, or a human-required decision. But the operator must never need to read source code to recover. This contract enumerates every expected blocked state and mandates a structured recovery path.

## Interface

Every CLI error or blocked-state message MUST include:

```
┌─────────────────────────────────────────────────────────────┐
│  BLOCKED: {typed_reason}                                    │
│  Owner:   {human | orchestrator | agent}                    │
│  Action:  {exact recovery command or manual step}           │
│  Turn:    {turn_id remains assigned | turn cleared}         │
└─────────────────────────────────────────────────────────────┘
```

Fields:

| Field | Type | Description |
|-------|------|-------------|
| `typed_reason` | enum (see §Catalog) | Machine-readable reason for the block |
| `owner` | `human` \| `orchestrator` \| `agent` | Who must act to unblock |
| `recovery_action` | string | The exact CLI command or manual step |
| `turn_retained` | boolean | Whether the current turn assignment is preserved |

---

## Blocked State Catalog

### 1. Clean Baseline Violation

| Field | Value |
|-------|-------|
| Typed Reason | `clean_baseline_violation` |
| Trigger | `assignGovernedTurn()` for authoritative/proposed role with dirty working tree |
| Owner | `human` |
| Recovery | `git commit -am "..." && agentxchain step` or `git stash && agentxchain step` |
| Turn Retained | No (turn was never assigned) |

### 2. Pending Phase Transition (Human Approval Gate)

| Field | Value |
|-------|-------|
| Typed Reason | `pending_phase_transition` |
| Trigger | Turn accepted, exit gate has `requires_human_approval: true` |
| Owner | `human` |
| Recovery | `agentxchain approve-transition` |
| Turn Retained | No (turn was accepted and cleared) |

### 3. Pending Run Completion

| Field | Value |
|-------|-------|
| Typed Reason | `pending_run_completion` |
| Trigger | Turn accepted with `run_completion_request: true`, completion gate requires human approval |
| Owner | `human` |
| Recovery | `agentxchain approve-completion` |
| Turn Retained | No (turn was accepted and cleared) |

### 4. Needs Human (Agent Escalation)

| Field | Value |
|-------|-------|
| Typed Reason | `needs_human` |
| Trigger | Agent returned `status: "needs_human"` with a reason |
| Owner | `human` |
| Recovery | Resolve the stated issue, then `agentxchain step` or `agentxchain step --resume` |
| Turn Retained | Depends on whether turn was accepted with needs_human status |

### 5. Turn Validation Failure (Retryable)

| Field | Value |
|-------|-------|
| Typed Reason | `schema_error` \| `artifact_error` \| `verification_error` |
| Trigger | `accept-turn` finds invalid staged result |
| Owner | `human` or `agent` (retry) |
| Recovery | Fix staged result and re-run `agentxchain accept-turn`, or `agentxchain reject-turn --reason "..."` then `agentxchain step --resume` |
| Turn Retained | Yes (same turn_id, same or incremented attempt) |

### 6. Turn Validation Failure (Non-Retryable)

| Field | Value |
|-------|-------|
| Typed Reason | `assignment_error` \| `protocol_error` \| `budget_error` |
| Trigger | `accept-turn` finds non-retryable violation |
| Owner | `human` |
| Recovery | Investigate and fix the root cause. For `assignment_error`: check state.json for stale turn. For `protocol_error`: ensure role meets challenge requirement. For `budget_error`: increase budget or complete run. |
| Turn Retained | Yes (turn remains assigned but cannot proceed without correction) |

### 7. Retry Exhausted (Escalation)

| Field | Value |
|-------|-------|
| Typed Reason | `retries_exhausted` |
| Trigger | `reject-turn` when attempt >= max_turn_retries |
| Owner | `human` |
| Recovery | `Resolve the escalation, then run agentxchain step` |
| Turn Retained | Yes (failed turn record preserved for auditability and redispatch context) |

> **Implementation note (DEC-BLOCKED-002):** The v1 implementation preserves `current_turn` in failed state when retries are exhausted. The run is paused with `blocked_on = "escalation:retries-exhausted:{role}"`. Recovery is via `agentxchain step`, which re-dispatches the preserved turn. Direct role reassignment to `eng_director` is a future policy option, not a current implementation truth.

### 8. Missing API Credential

| Field | Value |
|-------|-------|
| Typed Reason | `dispatch_error` |
| Trigger | `api_proxy` adapter cannot find the required auth env var |
| Owner | `human` |
| Recovery | `export {AUTH_ENV_VAR}=... && agentxchain step --resume` or complete the turn manually |
| Turn Retained | Yes (turn assigned, dispatch failed) |

### 9. Local CLI Subprocess Failure

| Field | Value |
|-------|-------|
| Typed Reason | `dispatch_error` |
| Trigger | `local_cli` subprocess exits non-zero or crashes |
| Owner | `human` |
| Recovery | Check subprocess output, fix the issue, then either stage `turn-result.json` manually and run `agentxchain accept-turn`, or `agentxchain reject-turn --reason "..."` |
| Turn Retained | Yes (turn assigned, subprocess failure is not turn rejection) |

### 10. Active Turn Already Assigned

| Field | Value |
|-------|-------|
| Typed Reason | `active_turn_exists` |
| Trigger | `agentxchain step` when a turn is already assigned |
| Owner | `human` |
| Recovery | `agentxchain step --resume` to re-enter the current turn, or `agentxchain accept-turn` / `agentxchain reject-turn --reason "..."` to resolve the current turn first |
| Turn Retained | Yes |

---

## Behavior Rules

1. **Every blocked state MUST produce a message that includes the recovery action.** The CLI must never print only the invariant that was violated. It must also print what to do next.

2. **Typed reasons are machine-readable.** They can be used by future tooling (dashboards, Slack notifications, CI integrations) to automate triage.

3. **Turn retention is explicit.** The operator must always know whether the current turn assignment survived the error or was cleared.

4. **Approval commands are strict in v1 (DEC-BLOCKED-003).** `approve-transition` and `approve-completion` succeed only when a matching pending object exists and `state.status === "paused"`. With no request identifier on the command, the CLI cannot safely distinguish "already approved" from "nothing pending." Idempotency is deferred until approvals have stable request identity.

5. **Recovery descriptors are the command-surface contract (DEC-BLOCKED-001).** Every blocked CLI surface MUST be reducible to a `RecoveryDescriptor` with four normative fields: `typed_reason`, `owner`, `recovery_action`, `turn_retained`. The schema is defined in `.planning/BLOCKED_STATE_INTERFACE.md`. This applies to `status`, `step`, `accept-turn`, and `reject-turn`.

---

## Acceptance Tests

| # | Test | Pass Condition |
|---|------|---------------|
| T1 | Dirty baseline → `step` for authoritative role | Error message includes "commit or stash" |
| T2 | Pending phase transition → `status` | Status shows recovery command `approve-transition` |
| T3 | Validation failure on `accept-turn` | Error includes both the violated invariant AND the recovery path |
| T4 | `reject-turn` at max retries | Output includes escalation path |
| T5 | `step` with active turn | Error includes `--resume` suggestion |
| T6 | Missing API key for `api_proxy` dispatch | Error names the specific env var to set |
| T7 | `needs_human` turn accepted | `status` shows the blocker reason and recovery path |

---

## Open Questions

1. Should v1.1 persist the derived recovery descriptor to `.agentxchain/blocked.json` for dashboards and editor integrations? (Consensus: yes for v1.1, stderr is sufficient for v1.0.)
2. ~~Should `approve-transition` and `approve-completion` be truly idempotent?~~ **Resolved (DEC-BLOCKED-003):** No. Strict in v1. Deferred until approvals have stable request identity.
3. Should a future version convert `retries_exhausted` into an explicit role handoff instead of preserving the failed turn for redispatch? (v2 design question.)
