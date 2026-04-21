# AgentXchain Governed Protocol — v5 Specification

> Normative spec for v1.1. Supersedes SPEC-GOVERNED-v4.md (v1.0 reference, preserved as-is).

---

## 1. Overview

AgentXchain is a governed convergence protocol for AI software teams. It assigns roles, requires structured turn results, validates artifacts and verification claims, enforces phase gates, and maintains append-only machine history alongside human-readable logs.

**The protocol is the product.** The runner is replaceable.

### 1.1 In Scope (v1.1)

- One project repo per run
- Parallel governed turns (up to 4 concurrent, configurable per phase)
- Sequential turns as the default (backward compatible with v1.0)
- Role-based routing with human checkpoints
- Structured turn results (JSON) plus human-readable prose
- Three runtime types: `manual`, `local_cli`, `api_proxy`
- Four artifact types: `workspace`, `patch`, `commit`, `review`
- Orchestrator-derived artifact truth (not agent self-reporting)
- Adapter-local auto-retry for `api_proxy` runtimes (opt-in)
- Preemptive tokenization for `api_proxy` runtimes (opt-in)
- Provider-specific error mapping (Anthropic, automatic)
- Persistent blocked state with structured recovery descriptors

### 1.2 Out of Scope (v1.1)

- Cross-repo workflows
- Automatic conflict resolution beyond retry/escalate and operator-chosen recovery
- Autonomous release execution
- `api_proxy` with authoritative or proposed write authority
- `max_concurrent_turns > 4`
- Push-based conflict notification
- Batch multi-turn adapter dispatch
- Provider error mapping for non-Anthropic providers
- Preemptive tokenization for `local_cli` or `manual` adapters

---

## 2. Canonical Runtime Model

The orchestrator manages a run using three entities:

1. **Run State** — the accepted state of the project and workflow
2. **Turn Assignment** — which role(s) are currently authorized to act
3. **Turn Result** — the structured output of one completed turn

Everything else is derivative:
- `TALK.md` is a human-readable transcript
- `history.jsonl` is an append-only evidence log
- `decision-ledger.jsonl` is a permanent decision record
- Phase summaries are projections over accepted turn results

---

## 3. Configuration (`agentxchain.json`)

Static project configuration, checked into the repo. Schema version `"1.0"` or `"1.1"`.

### 3.1 Top-Level Shape

```json
{
  "schema_version": "1.0",
  "project": { "id": "", "name": "", "default_branch": "main" },
  "roles": {},
  "runtimes": {},
  "routing": {},
  "gates": {},
  "budget": {},
  "retention": {},
  "prompts": {},
  "rules": {}
}
```

A v1.0 config with no new fields runs identically under v1.1. The runtime reads `"1.0"` and `"1.1"` config files equivalently.

### 3.2 Roles

Each role declares:

| Field | Type | Values |
|-------|------|--------|
| `title` | string | Human-readable name |
| `mandate` | string | Role's governing directive |
| `write_authority` | enum | `authoritative`, `proposed`, `review_only` |
| `runtime` | string | Reference to a runtime ID |

**Write authority semantics:**
- `authoritative` — may directly modify repo files
- `proposed` — may return patches but not directly update accepted state
- `review_only` — may not change product files; only emit review artifacts under `.planning/` or `.agentxchain/reviews/`

### 3.3 Runtimes

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `manual`, `local_cli`, `api_proxy` |
| `command` | local_cli | Command array, may contain `{prompt}` |
| `cwd` | local_cli | Working directory |
| `prompt_transport` | local_cli | `argv`, `stdin`, or `dispatch_bundle_only` |
| `provider` | api_proxy | Provider name (e.g., `anthropic`) |
| `model` | api_proxy | Model identifier |
| `auth_env` | api_proxy | Environment variable for API key |
| `max_output_tokens` | api_proxy | Optional. Default 4096. |
| `timeout_seconds` | api_proxy | Optional. Default 120. |
| `context_window_tokens` | api_proxy | Optional. Required when preflight is enabled. |
| `retry_policy` | api_proxy | Optional. Auto-retry config (v1.1). See §3.3.1. |
| `preflight_tokenization` | api_proxy | Optional. Preflight token budget config (v1.1). See §3.3.2. |

**v1.1 restriction:** `api_proxy` may only bind to `review_only` roles.

**`prompt_transport` rules:**
- `argv` — command/args must contain `{prompt}`; adapter substitutes before spawn
- `stdin` — adapter writes prompt to subprocess stdin
- `dispatch_bundle_only` — no automatic prompt delivery; operator reads from disk
- If omitted: inferred from command shape (`argv` if `{prompt}` present, else `dispatch_bundle_only`)

#### 3.3.1 Retry Policy (v1.1, opt-in)

```json
{
  "retry_policy": {
    "enabled": true,
    "max_attempts": 3,
    "base_delay_ms": 1000,
    "max_delay_ms": 8000,
    "backoff_multiplier": 2,
    "jitter": "full",
    "retry_on": ["rate_limited", "network_failure", "timeout"]
  }
}
```

- When `retry_policy` is absent or `enabled !== true`: v1.0 one-shot behavior.
- Retries are adapter-local. They do NOT create governed turns or mutate governed attempt counters.
- Retryable error classes: `rate_limited`, `network_failure`, `timeout`, `response_parse_failure`, `turn_result_extraction_failure`, `unknown_api_error`.
- Non-retryable classes (never retried regardless of config): `invalid_request`, `budget_error`, `context_overflow`, daily/spend 429s.
- Delay formula: `min(base_delay_ms * backoff_multiplier^attempt, max_delay_ms)` with optional full jitter.
- Audit artifact: `api-retry-trace.json` in the dispatch directory when retries occur.
- Success-path `turn-result.json -> cost` aggregates usage across all attempts.

**Config validation:**
- `max_attempts >= 1`
- `retry_on` contains only known classes

#### 3.3.2 Preemptive Tokenization (v1.1, opt-in)

```json
{
  "context_window_tokens": 200000,
  "preflight_tokenization": {
    "enabled": true,
    "tokenizer": "provider_local",
    "safety_margin_tokens": 2048
  }
}
```

- When `preflight_tokenization` is absent or `enabled !== true`: v1.0 behavior (overflow detected post-hoc via API error).
- Scope: `api_proxy` + `anthropic` provider only in v1.1.
- Token budget: `available_input_tokens = context_window_tokens - max_output_tokens - safety_margin_tokens`.
- If estimated input tokens exceed budget, attempt bounded compression of advisory context sections.
- If still over budget, fail locally with `context_overflow` without making the API call.
- Audit artifacts: `TOKEN_BUDGET.json` and `CONTEXT.effective.md` in the dispatch directory.

**Config validation:**
- `context_window_tokens` required when preflight is enabled (positive integer)
- `context_window_tokens > max_output_tokens + safety_margin_tokens`
- `safety_margin_tokens >= 0` (default 2048)

### 3.4 Routing

Each phase declares:

| Field | Description |
|-------|-------------|
| `entry_role` | Default role for the phase |
| `allowed_next_roles` | Hard allowlist; `human` is a reserved actor |
| `exit_gate` | Gate ID that must pass before phase advancement |
| `max_concurrent_turns` | Maximum parallel turns (v1.1). Default: `1`. Cap: `4`. |

Standard phases: `planning` -> `implementation` -> `qa`.

**Parallel turn rules (v1.1):**
- `max_concurrent_turns = 1` preserves v1.0 sequential behavior.
- A role may have at most one active turn at a time.
- Phase transitions require all active turns to be resolved before gate evaluation.
- New turn assignment is blocked when any active turn has `status === "blocked"`.

### 3.5 Gates

| Predicate | Behavior |
|-----------|----------|
| `requires_files` | Listed file paths must exist |
| `requires_verification_pass` | Turn verification status must be `pass` or `attested_pass` |
| `requires_human_approval` | Blocks auto-advance unless an `approval_policy` rule auto-approves the gate |
| `credentialed` | When `true`, marks a gate as protecting a credentialed, irreversible, or operator-owned action. Such gates cannot be auto-approved by policy. Missing defaults to `false` for compatibility. |

### 3.5.1 Approval Policy

`approval_policy` is the governed autonomy surface for routine human-approval gates. It is not a new protocol mode. A project is "full-auto" only when its config explicitly marks routine gates as non-credentialed and declares the policy rules that may close them.

Supported policy boundaries:

- `phase_transitions.default`: fallback action, `require_human` or `auto_approve`
- `phase_transitions.rules[]`: ordered first-match rules with optional `from_phase`, `to_phase`, and `when`
- `run_completion`: final run-completion action and optional `when`

Supported `when` predicates:

- `gate_passed`: the underlying gate predicates already passed
- `roles_participated`: listed roles have an accepted turn in the current phase
- `all_phases_visited`: every declared routing phase was active at least once
- `credentialed_gate: false`: the current gate is not credentialed; `true` is invalid

Invariants:

- The structural gate evaluator runs first. Policy cannot override missing files, failed verification, or gate semantic failures.
- `credentialed: true` is a hard stop. No policy rule, including a catch-all `auto_approve`, can close it.
- Policy auto-approval writes a `type: "approval_policy"` decision-ledger entry with the matched rule, reason, gate id, gate type, and timestamp.
- `--auto-approve` is a blanket operator override and is not equivalent to project-owned full-auto policy.

### 3.6 Budget

Optional budget configuration:

| Field | Type | Notes |
|-------|------|-------|
| `budget.max_usd` | number | Total budget for the run |

**Parallel budget reservation (v1.1):** Each active turn reserves an estimated USD amount at assignment time. New assignment fails when unreserved budget is insufficient.

### 3.7 Validation Rules

- Unknown top-level keys are rejected
- Every role must reference an existing runtime
- Every routing role must exist or be `human`
- Every gate referenced by routing must exist
- `review_only` roles cannot use `local_cli` runtimes
- `api_proxy` runtimes may only bind to `review_only` roles (v1.1)
- `argv` transport requires `{prompt}` placeholder in command
- `max_concurrent_turns` must be `>= 1` and `<= 4` (v1.1 cap)
- Retry and preflight config rules per §3.3.1 and §3.3.2

---

## 4. Run State (`state.json`)

Mutable runtime state. Written only by the orchestrator.

### 4.1 Schema (v1.1)

```json
{
  "schema_version": "1.1",
  "run_id": "run_...",
  "project_id": "...",
  "status": "idle | active | paused | blocked | completed | failed",
  "phase": "planning | implementation | qa",
  "accepted_integration_ref": "git:abc123 | null",

  "active_turns": {
    "turn_abc": {
      "turn_id": "turn_abc",
      "assigned_role": "dev",
      "status": "running | retrying | conflicted | failed",
      "attempt": 1,
      "started_at": "ISO8601",
      "deadline_at": "ISO8601",
      "runtime_id": "local-dev",
      "assigned_sequence": 1,
      "baseline": { "kind": "git", "head_ref": "...", "clean": true },
      "declared_file_scope": [],
      "conflict_state": null
    }
  },
  "turn_sequence": 2,

  "last_completed_turn_id": "turn_...",
  "next_recommended_role": "qa | null",

  "blocked_on": "null | human:... | escalation:...",
  "blocked_reason": null,
  "escalation": null,

  "queued_phase_transition": null,
  "queued_run_completion": null,
  "pending_phase_transition": null,
  "pending_run_completion": null,

  "phase_gate_status": {},
  "budget_status": { "spent_usd": 0, "remaining_usd": 50 },
  "budget_reservations": {}
}
```

### 4.2 Run Status Values

| Status | Meaning |
|--------|---------|
| `idle` | Initialized, no run started |
| `active` | Run in progress, turns may be assigned and accepted |
| `paused` | Protocol-initiated pause for a known human approval action (phase transition or run completion) |
| `blocked` | Run cannot make forward progress; requires human diagnosis or external action |
| `completed` | All phases complete, final approval recorded |
| `failed` | Terminal failure (reserved) |

**`blocked` vs `paused` (v1.1):**
- `paused` = the operator knows exactly what to do (approve-transition or approve-completion).
- `blocked` = the operator must diagnose and resolve a problem before resuming.
- `blocked` requires `blocked_reason` with a structured `BlockedReason` containing `category`, `recovery`, `blocked_at`, and `turn_id`.

**`blocked` entry conditions:**
- Accepted `needs_human` turn result
- Retry exhaustion / escalation
- Surfaced dispatch failure after adapter-local retries are exhausted or the error is non-retryable

**`blocked` does not cancel sibling turns.** Already-running non-blocked turns may still be accepted, but no new turns may be assigned.

### 4.3 Active Turns (v1.1, replaces `current_turn`)

`active_turns` is a map keyed by `turn_id`. An empty map means no turns are active. Each entry is an `ActiveTurn`:

| Field | Type | Notes |
|-------|------|-------|
| `turn_id` | string | Format: `turn_XXXXXXXX` |
| `assigned_role` | string | Role that owns this turn |
| `status` | enum | `running`, `retrying`, `conflicted`, `failed` |
| `attempt` | number | Current attempt (starts at 1) |
| `started_at` | string | ISO 8601 |
| `deadline_at` | string | ISO 8601 |
| `runtime_id` | string | Runtime used for this turn |
| `assigned_sequence` | number | `turn_sequence` value at assignment time |
| `baseline` | object | Git baseline at assignment time |
| `declared_file_scope` | string[] | Optional advisory file intent |
| `conflict_state` | object/null | Persisted conflict descriptor if `status === "conflicted"` |
| `last_rejection` | object/null | Details of last rejection if `status === "retrying"` |

### 4.4 Turn Sequence

`turn_sequence` is a monotonic logical clock replacing wall-clock ordering. Incremented on each assignment and each acceptance. History entries record both `assigned_sequence` and `accepted_sequence`.

### 4.5 Queued Drain Requests (v1.1)

When a turn result requests a phase transition or run completion while sibling turns are still active, the request is queued:

- `queued_phase_transition` — held until all siblings resolve, then evaluated at drain time.
- `queued_run_completion` — held until all siblings resolve, then evaluated at drain time.

After drain, these move to the existing `pending_phase_transition` / `pending_run_completion` approval surfaces.

### 4.6 Budget Reservations (v1.1)

`budget_reservations` maps `turn_id` to estimated cost reservations. New assignment fails if unreserved budget is insufficient. Reservations are released on acceptance/rejection.

### 4.7 State Ownership

Only the orchestrator may write:
- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`

Agents may read these files. They may not write to them.

### 4.8 Schema Migration (v1.0 -> v1.1)

v1.1 reads `"1.0"` state files and migrates in place on first load:

1. `current_turn` (if present) -> `active_turns[turn_id]`; `current_turn` field removed.
2. `paused + blocked_on starting with "human:" or "escalation:"` -> `status: "blocked"` with `blocked_reason`.
3. `schema_version` updated to `"1.1"`.

**Forward compatibility:** v1.1 rejects state files with unknown `schema_version` values (anything other than `"1.0"` or `"1.1"`). v1.0 does NOT read `"1.1"` state files.

**Post-migration invariant:** A `"1.1"` state file must not contain `current_turn`.

---

## 5. Turn Result Contract

Every turn produces this shape. The orchestrator validates it before acceptance.

```json
{
  "schema_version": "1.0",
  "run_id": "...",
  "turn_id": "...",
  "role": "...",
  "runtime_id": "...",
  "status": "completed | blocked | needs_human | failed",
  "summary": "...",
  "decisions": [
    { "id": "DEC-NNN", "category": "...", "statement": "...", "rationale": "..." }
  ],
  "objections": [
    { "id": "OBJ-NNN", "severity": "low|medium|high|blocking", "statement": "...", "status": "raised" }
  ],
  "files_changed": ["..."],
  "artifacts_created": ["..."],
  "verification": {
    "status": "pass | fail | skipped",
    "commands": ["..."],
    "evidence_summary": "...",
    "machine_evidence": [{ "command": "...", "exit_code": 0 }]
  },
  "artifact": { "type": "workspace|patch|commit|review", "ref": "..." },
  "proposed_next_role": "...",
  "phase_transition_request": "implementation | qa | null",
  "run_completion_request": false,
  "needs_human_reason": "... | null",
  "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 }
}
```

### 5.1 Required Invariants

- `run_id` and `turn_id` must match current assignment
- `role` and `runtime_id` must match current assignment
- `proposed_next_role` must be routing-legal or `human`
- `review_only` roles must not declare product file changes
- `review_only` roles must have `artifact.type = "review"`
- `phase_transition_request` and `run_completion_request` are mutually exclusive
- Decision IDs match `DEC-NNN`, objection IDs match `OBJ-NNN`

### 5.2 Normalized Verification Status

The orchestrator normalizes verification at acceptance time:

| External Status | Runtime Type | Normalized Status |
|-----------------|-------------|-------------------|
| `pass` | `local_cli` + all exit_code=0 | `pass` |
| `pass` | `local_cli` + any exit_code!=0 | `not_reproducible` |
| `pass` | `local_cli` + no evidence | `not_reproducible` |
| `pass` | `manual` | `attested_pass` |
| `pass` | `api_proxy` | `attested_pass` |
| `fail` | any | `fail` |
| `skipped` | any | `skipped` |

### 5.3 Cost Accounting

- Provider telemetry is the authoritative cost source.
- Hardcoded model rates are fallback estimation only.
- When auto-retry is enabled, the success-path cost aggregates usage across all adapter-local attempts.

---

## 6. Validation Pipeline

Five stages, executed in order. Short-circuits on first failure.

| Stage | Name | Error Class | Checks |
|-------|------|------------|--------|
| A | Schema | `schema_error` | Valid JSON, required fields, enum values, field types, ID patterns |
| B | Assignment | `assignment_error` | run_id, turn_id, role, runtime_id match current assignment |
| C | Artifact | `artifact_error` | Write authority compliance, reserved path protection, artifact type consistency |
| D | Verification | `verification_error` | Evidence consistency, exit code truth, pass claim requires evidence |
| E | Protocol | `protocol_error` | Challenge requirement (review_only must have objections), routing legality, mutual exclusion of phase/run requests |

---

## 7. Orchestrator State Machine

### 7.1 States

`idle` -> `active` -> `paused` / `blocked` -> `completed`

### 7.2 Transitions

| Current | Action | Precondition | Next | Side Effects |
|---------|--------|-------------|------|-------------|
| idle/paused | initializeRun | config valid | active | Creates run_id |
| active | assignTurn | capacity available, baseline clean, budget reserved | active (turn assigned) | Captures baseline, writes state, increments turn_sequence |
| active (turn running) | acceptTurn | staged result valid, no file conflict | active or paused or completed | Appends history/ledger/TALK, evaluates gates, increments turn_sequence |
| active (turn running) | acceptTurn | staged result valid, file conflict detected | active (turn conflicted) | Persists conflict_state on the turn |
| active (turn running) | acceptTurn with needs_human | staged result valid | blocked | Sets blocked_on, blocked_reason |
| active (turn running) | rejectTurn | retries remaining | active (attempt++) | Preserves rejected artifact |
| active (turn running) | rejectTurn | retries exhausted | blocked (escalated) | Creates escalation, sets blocked_reason |
| active (conflicted) | reject --reassign | retries remaining | active (rebased, attempt++) | Re-baselines, redispatches with conflict context |
| active (conflicted) | human_merge | operator resolves | active (re-validate) | Re-runs acceptance pipeline |
| paused (pending_phase_transition) | approveTransition | human approval | active (new phase) | Advances phase |
| paused (pending_run_completion) | approveCompletion | human approval | completed | Terminal |
| blocked | step --resume | operator resolves | active | Clears blocked state |

### 7.3 Key Rules

- The orchestrator never enters `accepting` for an unvalidated turn result
- Phase advancement is gate-driven and orchestrator-enforced, never from agent suggestion alone
- Phase transitions require all active turns resolved before gate evaluation (v1.1)
- Acceptance never auto-assigns the next turn
- Retry is per turn assignment, not per phase
- Budget tracking is monotonically non-decreasing
- History is append-only
- `blocked` blocks new assignment but does not cancel running sibling turns (v1.1)
- Acceptance is serialized: an acceptance lock prevents concurrent acceptance mutations (v1.1)

### 7.4 Acceptance Serialization (v1.1)

When parallel turns are active, acceptances are serialized:
- An acceptance lock prevents concurrent acceptance mutations
- A transaction journal records the acceptance pipeline stages
- History, ledger, and state commits are deterministically ordered by acceptance sequence
- The lock is released after state commit, even on failure

### 7.5 Conflict Detection (v1.1)

File-level conflict detection at acceptance time:

- Two turns conflict when their observed changed files overlap AND the later turn was assigned before the earlier turn was accepted.
- Conflict detection compares observed files, not declared scopes.
- `declared_file_scope` overlap at assignment time is advisory only (non-fatal warning).
- Conflicted turns persist `conflict_state` in `active_turns` until operator resolution.

**Operator resolution paths:**
1. `reject_and_reassign` — same `turn_id`, increment `attempt`, re-baseline against accepted state, redispatch with structured conflict context. Shares the normal `max_turn_retries` budget.
2. `human_merge` — operator manually resolves files, re-runs acceptance pipeline. Preserves `turn_id` and `attempt`.

**Guardrails:**
- No silent auto-merge or auto-accept for conflicts.
- Repeated unresolved re-conflict is bounded by a loop guard.
- Future three-way merge may only create a reviewable proposal artifact, never auto-accept.

---

## 8. Repo Observation

The orchestrator independently verifies what happened in the repo.

### 8.1 Baseline Capture

At turn assignment time, the orchestrator snapshots:
- Git HEAD ref
- Working tree clean status
- Timestamp

### 8.2 Change Observation

At acceptance time, the orchestrator computes:
- Actual files changed (via `git diff` against baseline)
- Current HEAD ref
- Diff summary

### 8.3 Operational Path Exclusion

Orchestrator-owned paths are excluded from actor observation:
- `.agentxchain/dispatch/`
- `.agentxchain/staging/`

### 8.4 Clean Baseline Rule

- `authoritative` and `proposed` turns require a clean working tree
- `review_only` turns may proceed on dirty trees
- Operational paths are excluded from the clean check

### 8.5 Declared vs. Observed Comparison

For `authoritative` roles: undeclared file changes are an `artifact_error`.
For `review_only` roles: any observed product file changes are an `artifact_error`.

### 8.6 Integration Ref Derivation

`accepted_integration_ref` is derived from orchestrator observation, not from the agent's `artifact.ref`.

This field is a git anchor, not a full workspace-state identifier. The exact accepted state is the combination of `accepted_integration_ref` and the corresponding `history.jsonl` row's `observed_artifact`.

---

## 9. Dispatch Bundle

### 9.1 Turn-Scoped Dispatch Bundles

Dispatch bundles are turn-scoped in v1.1, including the default sequential case. When only one turn is active, there is simply one live bundle:

- `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json`
- `.agentxchain/dispatch/turns/<turn_id>/PROMPT.md`
- `.agentxchain/dispatch/turns/<turn_id>/CONTEXT.md`
- `.agentxchain/staging/<turn_id>/turn-result.json`

Sequential behavior remains backward-compatible at the workflow level (`max_concurrent_turns = 1`), but the filesystem handoff is no longer the legacy singleton `dispatch/current/` layout.

### 9.2 Parallel Turn Isolation (v1.1)

When `max_concurrent_turns > 1`, multiple turn-scoped bundles may coexist:

- `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json`
- `.agentxchain/dispatch/turns/<turn_id>/PROMPT.md`
- `.agentxchain/dispatch/turns/<turn_id>/CONTEXT.md`
- `.agentxchain/staging/<turn_id>/turn-result.json`

`dispatch/index.json` is the operator-visible manifest listing all active dispatch bundles.

### 9.3 Conflict Context in Redispatch

When a turn is redispatched after `reject_and_reassign`, the bundle carries structured conflict context:
- Which files conflicted
- Which turn was accepted ahead of this one
- The new baseline ref

Dispatch bundles are ephemeral projections, re-materialized on every resume/retry.

---

## 10. Adapters

### 10.1 Manual

- `dispatchTurn`: writes dispatch bundle, prints operator instructions
- `collectTurn`: reads staged `turn-result.json` when operator runs `accept-turn`

### 10.2 Local CLI

- `dispatchTurn`: spawns subprocess with prompt delivered via configured transport
- `collectTurn`: reads staged `turn-result.json` after process exits
- Subprocess success is NOT turn success — only validated staged JSON is turn success

### 10.3 API Proxy (v1.1: review-only, with retry and preflight)

- Synchronous request/response within `step`
- Sends rendered PROMPT.md + CONTEXT.md as API request
- Requires structured JSON response matching turn result schema
- Cost overwritten from provider telemetry (not agent self-report)
- Persists `API_REQUEST.json` and `provider-response.json` for audit
- v1.1 restriction: review-only roles only, no tool use, no patch application

**Auto-retry (opt-in, v1.1):** When `retry_policy.enabled === true`, transient failures are retried with exponential backoff within the same `step` dispatch. Retries are adapter-local — no governed state mutation. See §3.3.1.

**Preemptive tokenization (opt-in, v1.1):** When `preflight_tokenization.enabled === true`, the adapter computes a local token budget before dispatch. Context overflow is caught locally without making the API call. See §3.3.2.

**Provider error mapping (automatic, v1.1):** For the `anthropic` provider, error classification uses provider-native error types before falling back to HTTP status codes:
- `error.type = "invalid_request_error"` -> `invalid_request` (non-retryable)
- `error.type = "rate_limit_error"` -> `rate_limited` (retryable unless daily/spend indicator present)
- `error.type = "overloaded_error"` or HTTP 529 -> `provider_overloaded` (retryable)
- `provider_error_type` and `provider_error_code` are preserved in `api-error.json`
- Unknown structured provider errors fall back to HTTP classification while preserving provider fields

### 10.4 Adapter Prohibitions

Adapters may not:
- Mutate `state.json`
- Decide phase transitions
- Silently drop malformed output
- Bypass validation

---

## 11. CLI Commands

### 11.1 Sequential Commands (v1.0 compatible)

| Command | Description |
|---------|-------------|
| `init --governed` | Scaffold a governed v5 project |
| `migrate` | Convert a legacy v3 project to governed format |
| `resume` | Initialize or continue a governed run and assign the next turn |
| `status` | Show current phase, role, budget, blockers |
| `status --json` | Structured output for scripts and dashboards |
| `step` | Assign and dispatch the next turn |
| `step --role <role>` | Override role selection |
| `step --resume` | Continue an already assigned turn |
| `accept-turn` | Validate and accept the staged result |
| `reject-turn --reason <text>` | Reject the staged turn result, retry, or escalate |
| `approve-transition` | Approve pending phase transition |
| `approve-completion` | Approve pending run completion |
| `validate` | Validate governed config, state, and staged artifacts |

### 11.2 Parallel Turn Targeting (v1.1)

When `max_concurrent_turns > 1` and multiple turns are active:

| Command | Description |
|---------|-------------|
| `status` | Shows all active turns with turn IDs and statuses |
| `status --json` | Includes full `active_turns` map |
| `step --resume --turn <id>` | Resume a specific active turn |
| `accept-turn --turn <id>` | Accept a specific turn's staged result |
| `reject-turn --turn <id>` | Reject a specific turn's staged result |
| `reject-turn --turn <id> --reassign` | Conflict-specific: reject, re-baseline, redispatch |

**Ambiguity guard:** `step --resume`, `accept-turn`, and `reject-turn` fail with guidance when multiple turns are active and `--turn` is omitted.

### 11.3 Blocked State Rendering (v1.1)

When `status === "blocked"`:
- `status` renders `BLOCKED` with the blocked reason category and recovery guidance
- Recovery actions are shown based on `blocked_reason.recovery`
- `step --resume` is the primary recovery path for preserved-turn blocked states

---

## 12. File Layout

```
agentxchain.json            # Static config (human-authored)

.agentxchain/
  state.json                # Run state (orchestrator-owned)
  history.jsonl             # Turn history (orchestrator-appended)
  decision-ledger.jsonl     # Decision record (orchestrator-appended)
  prompts/                  # Role prompt templates (human-authored)
  reviews/                  # QA/director review artifacts
  staging/                  # Turn result staging area (ephemeral)
    <turn_id>/              # v1.1: per-turn staging isolation
  dispatch/                 # Dispatch bundles (ephemeral)
    turns/                  # v1.1: per-turn dispatch isolation
      <turn_id>/
    index.json              # v1.1: active dispatch manifest
    rejected/               # Preserved rejected artifacts

.planning/
  PM_SIGNOFF.md             # PM sign-off document
  ROADMAP.md                # Roadmap with acceptance criteria
  acceptance-matrix.md      # QA acceptance verdict matrix
  ship-verdict.md           # QA ship/no-ship verdict

TALK.md                     # Human-readable collaboration log
```

### 12.1 Reserved Paths (agents must not write)

- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `.agentxchain/lock.json`

---

## 13. Error Taxonomy

| Code | Meaning | Retryable |
|------|---------|-----------|
| `schema_error` | Malformed turn result | yes |
| `assignment_error` | Stale or mismatched turn identity | no |
| `artifact_error` | Declared/observed file mismatch | yes |
| `verification_error` | Evidence inconsistency | yes |
| `protocol_error` | Challenge/gate/routing violation | no |
| `budget_error` | Budget threshold exceeded | no |
| `config_error` | Invalid configuration | no |
| `dispatch_error` | Adapter failed to start turn | yes |
| `timeout_error` | Turn exceeded deadline | yes |
| `context_overflow` | Preflight token budget exceeded (v1.1) | no |
| `invalid_request` | Provider rejected the request shape (v1.1) | no |
| `provider_overloaded` | Provider temporarily overloaded (v1.1) | yes |

Retryable errors retry up to `rules.max_turn_retries` (default: 2). Non-retryable errors escalate or block.

---

## 14. Challenge Requirement

The core protocol differentiator. Enforced mechanically:

- `review_only` roles MUST have a non-empty `objections` array. Empty objections from a review role is a `protocol_error`.
- `authoritative` roles may have empty objections only on the first turn in a phase.
- Objection substance is not validated by the orchestrator — but the structural requirement is enforced.

---

## 15. Acceptance Semantics

| Concept | Meaning |
|---------|---------|
| **Turn completed** | Runtime finished and produced a parseable result |
| **Turn accepted** | Orchestrator validated the result and promoted its artifact |
| **Turn conflicted** | Accepted result has file overlap with a concurrently accepted peer (v1.1) |
| **Phase advanced** | Exit gate for current phase passed |
| **Run completed** | Final gate passed and human approval recorded |

Acceptance never auto-assigns the next turn. `next_recommended_role` is stored in state for `step` to use as a default, but the operator may override with `--role`.

---

## 16. v1.0 Compatibility

This section summarizes the backward compatibility contract.

### 16.1 Config Compatibility

A valid v1.0 `agentxchain.json` with `schema_version: "1.0"` and no v1.1 fields runs identically under v1.1. The runtime does not require config changes to upgrade.

### 16.2 State Migration

v1.1 reads and migrates `"1.0"` state files in place (see §4.8). v1.0 does NOT read `"1.1"` state files. There is no forward compatibility guarantee.

### 16.3 Behavioral Preservation

With default settings (no `retry_policy`, no `preflight_tokenization`, `max_concurrent_turns = 1` or absent):
- Sequential single-turn behavior is unchanged
- Turn lifecycle, validation, acceptance, and rejection are identical to v1.0

The two automatic behaviors (provider error mapping and persistent blocked state) improve classification precision and state visibility without changing operator-required actions.

---

## Appendix A: Acceptance Criteria Traceability

These align with AT-1 through AT-10 from `.planning/V1_1_RELEASE_SCOPE_SPEC.md`:

| ID | Criterion | Spec Section |
|----|-----------|-------------|
| AT-1 | v1.0 config backward compatibility | §16.1, §3.1 |
| AT-2 | v1.0 -> v1.1 state migration | §4.8 |
| AT-3 | Parallel turn happy path | §4.3, §7.2, §9.2 |
| AT-4 | Parallel conflict detection | §7.5 |
| AT-5 | Retry policy activation | §3.3.1, §10.3 |
| AT-6 | Retry exhaustion blocks the run | §4.2, §7.2 |
| AT-7 | Preemptive tokenization overflow | §3.3.2, §10.3 |
| AT-8 | Provider error mapping precision | §10.3, §13 |
| AT-9 | Blocked state visibility | §4.2, §11.3 |
| AT-10 | Forward compatibility guard | §4.8 |
