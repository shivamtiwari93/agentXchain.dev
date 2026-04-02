# AgentXchain Governed Protocol — v4 Specification

> Normative spec extracted from implementation. Version 0.9-beta.

---

## 1. Overview

AgentXchain is a governed convergence protocol for AI software teams. It assigns one role at a time, requires structured turn results, validates artifacts and verification claims, enforces phase gates, and maintains append-only machine history alongside human-readable logs.

**The protocol is the product.** The runner is replaceable.

### 1.1 In Scope (v1)

- One project repo per run
- One active turn at a time
- Role-based sequential routing with human checkpoints
- Structured turn results (JSON) plus human-readable prose
- Three runtime types: `manual`, `local_cli`, `api_proxy`
- Four artifact types: `workspace`, `patch`, `commit`, `review`
- Orchestrator-derived artifact truth (not agent self-reporting)

### 1.2 Out of Scope (v1)

- Parallel turns
- Multi-branch merge orchestration
- Cross-repo workflows
- Automatic conflict resolution beyond retry/escalate
- Autonomous release execution
- `api_proxy` with authoritative or proposed write authority

---

## 2. Canonical Runtime Model

The orchestrator manages a run using three entities:

1. **Run State** — the accepted state of the project and workflow
2. **Turn Assignment** — which role is currently authorized to act
3. **Turn Result** — the structured output of one completed turn

Everything else is derivative:
- `TALK.md` is a human-readable transcript
- `history.jsonl` is an append-only evidence log
- `decision-ledger.jsonl` is a permanent decision record
- Phase summaries are projections over accepted turn results

---

## 3. Configuration (`agentxchain.json`)

Static project configuration, checked into the repo. Schema version `"1.0"`.

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

**v1 restriction:** `api_proxy` may only bind to `review_only` roles.

**`prompt_transport` rules:**
- `argv` — command/args must contain `{prompt}`; adapter substitutes before spawn
- `stdin` — adapter writes prompt to subprocess stdin
- `dispatch_bundle_only` — no automatic prompt delivery; operator reads from disk
- If omitted: inferred from command shape (`argv` if `{prompt}` present, else `dispatch_bundle_only`)

### 3.4 Routing

Each phase declares:

| Field | Description |
|-------|-------------|
| `entry_role` | Default role for the phase |
| `allowed_next_roles` | Hard allowlist; `human` is a reserved actor |
| `exit_gate` | Gate ID that must pass before phase advancement |

Standard phases: `planning` → `implementation` → `qa`.

### 3.5 Gates

| Predicate | Behavior |
|-----------|----------|
| `requires_files` | Listed file paths must exist |
| `requires_verification_pass` | Turn verification status must be `pass` or `attested_pass` |
| `requires_human_approval` | Blocks auto-advance; run pauses for explicit `approve-transition` |

### 3.6 Validation Rules

- Unknown top-level keys are rejected
- Every role must reference an existing runtime
- Every routing role must exist or be `human`
- Every gate referenced by routing must exist
- `review_only` roles cannot use `local_cli` runtimes
- `api_proxy` runtimes may only bind to `review_only` roles (v1)
- `argv` transport requires `{prompt}` placeholder in command

---

## 4. Run State (`state.json`)

Mutable runtime state. Written only by the orchestrator.

```json
{
  "schema_version": "1.0",
  "run_id": "run_...",
  "project_id": "...",
  "status": "idle | active | paused | completed",
  "phase": "planning | implementation | qa",
  "accepted_integration_ref": "git:abc123 | null",
  "current_turn": {
    "turn_id": "turn_...",
    "assigned_role": "dev",
    "status": "running | retrying",
    "attempt": 1,
    "started_at": "ISO8601",
    "deadline_at": "ISO8601",
    "runtime_id": "local-dev",
    "baseline": { "kind": "git", "head_ref": "...", "clean": true }
  },
  "last_completed_turn_id": "turn_...",
  "next_recommended_role": "qa | null",
  "blocked_on": "null | human:... | escalation:...",
  "escalation": null,
  "phase_gate_status": {},
  "budget_status": { "spent_usd": 0, "remaining_usd": 50 }
}
```

### 4.1 State Ownership

Only the orchestrator may write:
- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`

Agents may read these files. They may not write to them.

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

`idle` → `active` → `paused` → `completed`

### 7.2 Transitions

| Current | Action | Precondition | Next | Side Effects |
|---------|--------|-------------|------|-------------|
| idle/paused | initializeRun | config valid | active | Creates run_id |
| active | assignTurn | no current_turn, clean baseline | active (turn assigned) | Captures baseline, writes state |
| active (turn running) | acceptTurn | staged result valid | active or paused or completed | Appends history/ledger/TALK, evaluates gates |
| active (turn running) | rejectTurn | retries remaining | active (attempt++) | Preserves rejected artifact |
| active (turn running) | rejectTurn | retries exhausted | paused (escalated) | Creates escalation |
| paused (pending_phase_transition) | approveTransition | human approval | active (new phase) | Advances phase |
| paused (pending_run_completion) | approveCompletion | human approval | completed | Terminal |
| any non-terminal | needs_human result | always | paused | Sets blocked_on |

### 7.3 Key Rules

- The orchestrator never enters `accepting` for an unvalidated turn result
- Phase advancement is gate-driven and orchestrator-enforced, never from agent suggestion alone
- Acceptance never auto-assigns the next turn
- Retry is per turn assignment, not per phase
- Human pause overrides all non-terminal states
- Budget tracking is monotonically non-decreasing
- History is append-only

---

## 8. Repo Observation

The orchestrator independently verifies what happened in the repo, rather than trusting agent claims.

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

These are never attributed to the acting agent.

### 8.4 Clean Baseline Rule

- `authoritative` and `proposed` turns require a clean working tree (no uncommitted actor-owned changes)
- `review_only` turns may proceed on dirty trees
- Operational paths are excluded from the clean check

### 8.5 Declared vs. Observed Comparison

For `authoritative` roles: undeclared file changes are an `artifact_error`.
For `review_only` roles: any observed product file changes are an `artifact_error`.

### 8.6 Integration Ref Derivation

`accepted_integration_ref` is derived from orchestrator observation, not from the agent's `artifact.ref`. For `workspace` and `review` artifacts, the orchestrator uses the observed HEAD ref.

This field is a git anchor, not a full workspace-state identifier. If the accepted artifact includes uncommitted workspace changes, the exact accepted state is the combination of:

- `accepted_integration_ref` as the best-known git lineage anchor
- the corresponding `history.jsonl` row's `observed_artifact`

v1 does not define a separate workspace snapshot hash. Auditability is preserved through `observed_artifact.files_changed` and `observed_artifact.diff_summary`.

---

## 9. Dispatch Bundle

For every turn, the orchestrator writes three files to `.agentxchain/dispatch/current/`:

| File | Content |
|------|---------|
| `ASSIGNMENT.json` | Machine-readable turn envelope (run_id, turn_id, phase, role, write_authority, reserved_paths, allowed_next_roles, attempt, deadline) |
| `PROMPT.md` | Rendered role prompt + protocol rules + write authority rules + gate requirements + retry context + output schema template |
| `CONTEXT.md` | Current state summary + last turn summary + blockers + escalation + gate status |

Dispatch bundles are ephemeral projections. They are re-materialized on every resume/retry.

---

## 10. Adapters

### 10.1 Manual

- `dispatchTurn`: writes dispatch bundle, prints operator instructions, and leaves the run `active` with the assigned `current_turn` while the operator or `step` waits for a staged result
- `collectTurn`: reads staged `turn-result.json` when operator runs `accept-turn`

Waiting on a manual turn is not itself a paused run state. In v1, `paused` is reserved for actual blocked states such as human-approval gates, `needs_human`, or retries-exhausted escalation.

### 10.2 Local CLI

- `dispatchTurn`: spawns subprocess with prompt delivered via configured transport
- Prompt transport: `argv` (substitution), `stdin` (pipe), or `dispatch_bundle_only` (no delivery)
- `collectTurn`: reads staged `turn-result.json` after process exits
- Subprocess success is NOT turn success — only validated staged JSON is turn success

### 10.3 API Proxy (v1: review-only)

- Synchronous request/response within `step`
- Sends rendered PROMPT.md + CONTEXT.md as API request
- Requires structured JSON response matching turn result schema
- Cost overwritten from provider telemetry (not agent self-report)
- Persists `API_REQUEST.json` and `provider-response.json` for audit
- v1 restriction: review-only roles only, no tool use, no patch application

### 10.4 Adapter Prohibitions

Adapters may not:
- Mutate `state.json`
- Decide phase transitions
- Silently drop malformed output
- Bypass validation

---

## 11. CLI Commands

| Command | Description |
|---------|-------------|
| `init --governed` | Scaffold a governed v4 project |
| `migrate` | Convert a legacy v3 project to governed v4 and leave it paused for human review |
| `resume` | Initialize or continue a governed run and assign or redispatch the next turn without waiting for completion |
| `status` | Show current phase, role, budget, blockers |
| `step` | Assign and dispatch the next turn |
| `step --role <role>` | Override role selection |
| `step --resume` | Continue an already assigned turn and re-enter adapter wait/dispatch flow |
| `accept-turn` | Validate and accept the currently staged result for the active turn |
| `reject-turn --reason <text>` | Reject the current staged turn result, retry, or escalate |
| `approve-transition` | Approve pending phase transition |
| `approve-completion` | Approve pending run completion |
| `validate` | Validate governed config, state, and staged artifacts |

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
  dispatch/                 # Dispatch bundles (ephemeral)
    current/                # Current turn's ASSIGNMENT.json, PROMPT.md, CONTEXT.md
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

Retryable errors retry up to `rules.max_turn_retries` (default: 2). Non-retryable errors escalate to `eng_director` or `human`.

---

## 14. Challenge Requirement

The core protocol differentiator. Enforced mechanically:

- `review_only` roles MUST have a non-empty `objections` array. Empty objections from a review role is a `protocol_error`.
- `authoritative` roles may have empty objections only on the first turn in a phase.
- Objection substance is not validated by the orchestrator — but the structural requirement is enforced.

This applies to every `review_only` role in every phase, including PM planning turns. On an initial planning turn with no prior implementation to challenge, a low-severity structural objection is acceptable, for example a scope-risk note or an explicit "no prior work to challenge yet" observation.

---

## 15. Acceptance Semantics

These are distinct:

| Concept | Meaning |
|---------|---------|
| **Turn completed** | Runtime finished and produced a parseable result |
| **Turn accepted** | Orchestrator validated the result and promoted its artifact |
| **Phase advanced** | Exit gate for current phase passed |
| **Run completed** | Final gate passed and human approval recorded |

Acceptance never auto-assigns the next turn. `next_recommended_role` is stored in state for `step` to use as a default, but the operator may override with `--role`.
