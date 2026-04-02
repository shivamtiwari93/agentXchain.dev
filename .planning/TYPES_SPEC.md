# Types Specification — v1

> Normative JSON shapes for every persisted and exchanged data structure in the governed protocol. Extracted from implementation, not aspirational.

---

## Purpose

Define the exact JSON shapes that flow through the governed protocol. Every field is documented with its type, optionality, writer, reader, and whether it is persisted or derived. If this spec and the code disagree, the code wins until the spec is updated.

---

## 1. `state.json` — Governed Run State

**Path:** `.agentxchain/state.json`
**Writer:** `governed-state.js` (exclusively)
**Reader:** All commands, adapters, dispatch-bundle, gate-evaluator, blocked-state

```typescript
interface GovernedRunState {
  // ── Identity ────────────────────────────────────────────────
  schema_version: "1.0";                      // REQUIRED. Literal.
  project_id: string;                         // REQUIRED. Slugified project name.
  run_id: string | null;                      // REQUIRED. Format: "run_XXXXXXXX" (8 hex).
                                              // null only when status === "idle".

  // ── Lifecycle ───────────────────────────────────────────────
  status: "idle" | "active" | "paused" | "completed" | "failed";
                                              // REQUIRED. "failed" is reserved/unreached in v1.
  phase: string;                              // REQUIRED. One of config.routing keys.
  completed_at?: string;                      // ISO 8601. Set when status → "completed".

  // ── Current Turn ────────────────────────────────────────────
  current_turn: CurrentTurn | null;           // REQUIRED. null when no turn assigned.
  last_completed_turn_id?: string | null;     // Format: "turn_XXXXXXXX".

  // ── Blocking ────────────────────────────────────────────────
  blocked_on?: string | null;                 // Reason string. Formats:
                                              //   "human:{reason}"
                                              //   "human_approval:{gate_id}"
                                              //   "escalation:retries-exhausted:{role}"
  escalation?: Escalation | null;

  // ── Pending Approvals ───────────────────────────────────────
  pending_phase_transition?: PendingPhaseTransition | null;
  pending_run_completion?: PendingRunCompletion | null;

  // ── Tracking ────────────────────────────────────────────────
  accepted_integration_ref?: string | null;   // "git:{sha}" | "workspace:dirty" | null.
                                              // Derived by orchestrator, never from agent JSON.
  next_recommended_role?: string | null;      // Advisory. Derived after acceptance.
  phase_gate_status?: Record<string, "pending" | "passed" | "failed">;
  budget_status?: BudgetStatus;
}

interface CurrentTurn {
  turn_id: string;                            // Format: "turn_XXXXXXXX" (8 hex).
  assigned_role: string;                      // Role ID from config.roles.
  status: "running" | "retrying" | "failed";  // Only these three are persisted.
  attempt: number;                            // Starts at 1, incremented on retry.
  started_at: string;                         // ISO 8601.
  deadline_at: string;                        // ISO 8601. started_at + 20min (hardcoded).
  runtime_id: string;                         // Runtime ID from config.runtimes.
  baseline?: Baseline;                        // Captured at assignment time.
  last_rejection?: LastRejection;             // Set on first rejection, updated on each retry.
}

interface Baseline {
  kind: "git_worktree" | "no_git";
  head_ref: string | null;                    // Git HEAD SHA or null.
  clean: boolean;
  captured_at: string;                        // ISO 8601.
}

interface LastRejection {
  turn_id: string;
  attempt: number;
  rejected_at: string;                        // ISO 8601.
  reason: string;
  validation_errors: string[];
  failed_stage: string;                       // e.g., "schema", "artifact", "protocol".
}

interface Escalation {
  from_role: string;
  from_turn_id: string;
  reason: string;
  validation_errors: string[];
  escalated_at: string;                       // ISO 8601.
}

interface PendingPhaseTransition {
  from: string;                               // Source phase.
  to: string;                                 // Target phase.
  gate: string;                               // Gate ID that required approval.
  requested_by_turn: string;                  // Turn ID that triggered it.
}

interface PendingRunCompletion {
  gate: string;                               // Exit gate of final phase.
  requested_by_turn: string;
  requested_at: string;                       // ISO 8601.
}

interface BudgetStatus {
  spent_usd: number;                          // Cumulative from all accepted turns.
  remaining_usd: number | null;               // null if no budget limit configured.
}
```

### State Ownership Rule

Only `governed-state.js` writes to `state.json`. Adapters, agents, and CLI commands read it but never write directly. Any external write is a protocol violation.

---

## 2. `turn-result.json` — Staged Turn Result

**Path:** `.agentxchain/staging/<turn_id>/turn-result.json`
**Writer:** Agent (via adapter or manual)
**Reader:** `turn-result-validator.js`, `acceptGovernedTurn()`
**JSON Schema:** `cli/src/lib/schemas/turn-result.schema.json` (draft 2020-12)

```typescript
interface TurnResult {
  // ── Identity (must match state) ─────────────────────────────
  schema_version: "1.0";                      // REQUIRED. Literal.
  run_id: string;                             // REQUIRED. Must match state.run_id.
  turn_id: string;                            // REQUIRED. Must match state.current_turn.turn_id.
  role: string;                               // REQUIRED. Pattern: /^[a-z0-9_-]+$/.
  runtime_id: string;                         // REQUIRED. Must match state.current_turn.runtime_id.

  // ── Outcome ─────────────────────────────────────────────────
  status: "completed" | "blocked" | "needs_human" | "failed";  // REQUIRED.
  summary: string;                            // REQUIRED. minLength: 1.

  // ── Governance ──────────────────────────────────────────────
  decisions: Decision[];                      // REQUIRED. May be empty.
  objections: Objection[];                    // REQUIRED. Must be non-empty for review_only roles.

  // ── File Tracking ───────────────────────────────────────────
  files_changed: string[];                    // REQUIRED. Must be empty for review_only.
  artifacts_created?: string[];               // OPTIONAL. Paths under .planning/ or .agentxchain/reviews/.

  // ── Verification ────────────────────────────────────────────
  verification: Verification;                 // REQUIRED.

  // ── Artifact ────────────────────────────────────────────────
  artifact: Artifact;                         // REQUIRED.

  // ── Routing ─────────────────────────────────────────────────
  proposed_next_role: string;                 // REQUIRED. Pattern: /^[a-z0-9_-]+$|^human$/.
  phase_transition_request?: string | null;   // Target phase name. Mutually exclusive with run_completion_request.
  run_completion_request?: boolean | null;    // Explicit completion request for final-phase acceptance.

  // ── Human Blocking ──────────────────────────────────────────
  needs_human_reason?: string | null;         // Required when status === "needs_human".

  // ── Cost ────────────────────────────────────────────────────
  cost?: Cost;                                // OPTIONAL. Defaults to zero.
}

interface Decision {
  id: string;                                 // REQUIRED. Pattern: /^DEC-\d+$/.
  category: "implementation" | "architecture" | "scope" | "process" | "quality" | "release";
  statement: string;                          // REQUIRED. minLength: 1.
  rationale: string;                          // REQUIRED. minLength: 1.
}

interface Objection {
  id: string;                                 // REQUIRED. Pattern: /^OBJ-\d+$/.
  severity: "low" | "medium" | "high" | "blocking";  // REQUIRED.
  against_turn_id?: string;                   // OPTIONAL.
  against_decision_id?: string;               // OPTIONAL.
  statement: string;                          // REQUIRED. minLength: 1.
  proposed_resolution?: string;               // OPTIONAL.
  status?: "raised" | "acknowledged" | "resolved" | "escalated"
         | "resolved_by_human" | "resolved_by_director";  // Default: "raised".
}

interface Verification {
  status: "pass" | "fail" | "skipped";        // REQUIRED.
  commands?: string[];                        // OPTIONAL.
  evidence_summary?: string;                  // OPTIONAL.
  machine_evidence?: MachineEvidence[];       // OPTIONAL.
}

interface MachineEvidence {
  command: string;                            // REQUIRED.
  exit_code: number;                          // REQUIRED. Integer.
}

interface Artifact {
  type: "workspace" | "patch" | "commit" | "review";  // REQUIRED.
  ref?: string | null;                        // OPTIONAL. Git SHA, patch path, or null.
  diff_summary?: string;                      // OPTIONAL.
}

interface Cost {
  input_tokens?: number;                      // Default: 0. minimum: 0.
  output_tokens?: number;                     // Default: 0. minimum: 0.
  usd?: number;                               // Default: 0. minimum: 0.
}
```

### Validation Pipeline (5 Stages)

| Stage | Name | Checks |
|-------|------|--------|
| A | Schema | JSON structure, required fields, types, enums, patterns |
| B | Assignment | run_id, turn_id, role, runtime_id match state |
| C | Artifact | review_only cannot modify product files; declared vs observed files |
| D | Verification | Evidence consistency (pass with non-zero exit codes → error) |
| E | Protocol | Challenge requirement for review_only; routing legality; mutual exclusion of phase_transition_request / run_completion_request |

### Schema Alignment Note: `run_completion_request`

`run_completion_request` is now present in both places:

- the implementation validator (`turn-result-validator.js`)
- the formal JSON Schema (`cli/src/lib/schemas/turn-result.schema.json`)

This removes the prior mismatch where the runtime accepted the field but the formal schema omitted it.

---

## 3. `history.jsonl` — Accepted Turn History

**Path:** `.agentxchain/history.jsonl`
**Writer:** `acceptGovernedTurn()` in `governed-state.js` (one JSON line per accepted turn)
**Reader:** `dispatch-bundle.js` (last entry for context), verification, auditing

```typescript
interface HistoryEntry {
  // ── Identity ────────────────────────────────────────────────
  turn_id: string;                            // From turn result.
  run_id: string;                             // From turn result.

  // ── Role & Runtime ──────────────────────────────────────────
  role: string;
  runtime_id: string;

  // ── Outcome ─────────────────────────────────────────────────
  status: "completed" | "blocked" | "needs_human" | "failed";
  summary: string;

  // ── Governance (copied from turn result) ────────────────────
  decisions: Decision[];
  objections: Objection[];

  // ── File Tracking ───────────────────────────────────────────
  files_changed: string[];                    // Agent-declared.
  artifacts_created: string[];

  // ── Verification (both raw and normalized) ──────────────────
  verification: Verification;                 // Agent-supplied raw verification.
  normalized_verification: NormalizedVerification;  // Orchestrator-derived.

  // ── Artifacts (both agent-declared and orchestrator-observed) ─
  artifact: Artifact;                         // Agent-declared.
  observed_artifact: ObservedArtifact;        // Orchestrator-derived. Source of truth.

  // ── Routing ─────────────────────────────────────────────────
  proposed_next_role: string;
  phase_transition_request: string | null;

  // ── Cost ────────────────────────────────────────────────────
  cost: Cost;                                 // {} if not provided.

  // ── Timestamp ───────────────────────────────────────────────
  accepted_at: string;                        // ISO 8601.
}

interface NormalizedVerification {
  status: "pass" | "fail" | "skipped" | "attested_pass" | "not_reproducible";
  reason: string;                             // Explanation of normalization.
  reproducible: boolean;
}

interface ObservedArtifact {
  derived_by: "orchestrator";                 // Always "orchestrator".
  baseline_ref: string | null;                // "git:{sha}" or null.
  accepted_ref: string;                       // "git:{sha}" or "workspace:dirty".
  files_changed: string[];                    // Orchestrator-observed, excludes operational paths.
  diff_summary: string | null;
}
```

### Normalization Rules

| Runtime Type | Agent Says "pass" | Result |
|---|---|---|
| `manual` | Always | `attested_pass` (human attested, not reproducible) |
| `api_proxy` | Always | `attested_pass` (no execution environment) |
| `local_cli` + machine evidence all exit 0 | Yes | `pass` (reproducible) |
| `local_cli` + machine evidence with non-zero | Yes | `not_reproducible` |
| `local_cli` + no machine evidence | Yes | `not_reproducible` |
| Any | "fail" | `fail` |
| Any | "skipped" | `skipped` |

---

## 4. `decision-ledger.jsonl` — Decision Registry

**Path:** `.agentxchain/decision-ledger.jsonl`
**Writer:** `acceptGovernedTurn()` (one line per decision in the accepted turn)
**Reader:** Auditing, decision tracking, future objection resolution

```typescript
interface LedgerEntry {
  id: string;                                 // Decision ID, e.g., "DEC-001".
  turn_id: string;                            // Turn that made this decision.
  role: string;                               // Role that made the decision.
  phase: string;                              // Phase at time of acceptance.
  category: "implementation" | "architecture" | "scope" | "process" | "quality" | "release";
  statement: string;
  rationale: string;
  status: "accepted";                         // Always "accepted" (only accepted turns write here).
  objections_against: string[];               // OBJ IDs. Initially []. Populated by future turns.
  overridden_by: string | null;               // Turn ID. Initially null.
  created_at: string;                         // ISO 8601.
}
```

**Note:** `objections_against` and `overridden_by` are initialized as `[]` and `null` respectively. The current v1 implementation does **not** back-fill these fields when future objections reference past decisions. This is a v1.1 enhancement opportunity.

---

## 5. `ASSIGNMENT.json` — Dispatch Bundle Envelope

**Path:** `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json`
**Writer:** `writeDispatchBundle()` in `dispatch-bundle.js`
**Reader:** Adapter, agent

```typescript
interface Assignment {
  run_id: string;
  turn_id: string;
  phase: string;
  role: string;
  runtime_id: string;
  write_authority: "authoritative" | "proposed" | "review_only";
  accepted_integration_ref: string | null;
  staging_result_path: string;                // Always ".agentxchain/staging/<turn_id>/turn-result.json".
  reserved_paths: string[];                   // Always the 4 orchestrator-owned paths.
  allowed_next_roles: string[];               // From config.routing[phase].allowed_next_roles.
  attempt: number;
  deadline_at: string;                        // ISO 8601.
}
```

The dispatch bundle also includes two rendered markdown files:
- `PROMPT.md` — Role mandate, protocol rules, write authority constraints, gate requirements, retry context, output template
- `CONTEXT.md` — Run state summary, last accepted turn, blockers, escalation, gate file status

---

## 6. `RecoveryDescriptor` — Blocked State Recovery

**Source:** `deriveRecoveryDescriptor()` in `blocked-state.js`
**Not persisted.** Computed on demand from `state.json`.

```typescript
interface RecoveryDescriptor {
  typed_reason: "pending_run_completion"
              | "pending_phase_transition"
              | "needs_human"
              | "retries_exhausted"
              | "unknown_block";
  owner: "human";                             // Always "human" in v1.
  recovery_action: string;                    // CLI command or instruction.
  turn_retained: boolean;                     // Whether current_turn survived the error.
  detail: string | null;                      // Gate ID, blocked_on suffix, etc.
}
```

### Derivation Rules

| State Condition | typed_reason | recovery_action | turn_retained |
|---|---|---|---|
| `pending_run_completion` set | `pending_run_completion` | `agentxchain approve-completion` | false |
| `pending_phase_transition` set | `pending_phase_transition` | `agentxchain approve-transition` | false |
| `blocked_on` starts with `human:` | `needs_human` | `Resolve the stated issue, then run agentxchain step --resume` | `Boolean(current_turn)` |
| `blocked_on` starts with `human_approval:` | `pending_phase_transition` | `agentxchain approve-transition` | false |
| `blocked_on` starts with `escalation:` | `retries_exhausted` | `Resolve the escalation, then run agentxchain step` | `Boolean(current_turn)` |
| No `blocked_on` / null | returns `null` | N/A | N/A |

---

## 7. `GateResult` — Phase Exit Gate Evaluation

**Source:** `evaluatePhaseExit()` in `gate-evaluator.js`
**Not persisted.** Returned to `acceptGovernedTurn()` for state transition decisions.

```typescript
interface GateResult {
  gate_id: string | null;
  passed: boolean;
  blocked_by_human_approval: boolean;
  reasons: string[];
  missing_files: string[];
  missing_verification: boolean;
  next_phase: string | null;
  transition_request: string | null;
  action: "no_request"
        | "unknown_phase"
        | "gate_failed"
        | "advance"
        | "awaiting_human_approval"
        | "no_gate";
}
```

### Action Semantics

| Action | Meaning | Effect on State |
|---|---|---|
| `no_request` | No `phase_transition_request` in turn result | Stay in phase |
| `unknown_phase` | Requested phase doesn't exist in routing | Stay in phase, log error |
| `gate_failed` | Gate predicates not met | Accept turn, stay in phase |
| `advance` | Gate passed, no human approval | Advance phase immediately |
| `awaiting_human_approval` | Gate passed structurally, needs human | Pause, set pending_phase_transition |
| `no_gate` | Gate referenced in routing but not defined in config | Advance (treat as open) |

---

## 8. `RunCompletionResult` — Run Completion Evaluation

**Source:** `evaluateRunCompletion()` in `gate-evaluator.js`
**Not persisted.** Returned to `acceptGovernedTurn()`.

```typescript
interface RunCompletionResult {
  gate_id: string | null;
  passed: boolean;
  blocked_by_human_approval: boolean;
  reasons: string[];
  missing_files: string[];
  missing_verification: boolean;
  action: "no_request"
        | "not_final_phase"
        | "gate_failed"
        | "complete"
        | "awaiting_human_approval";
}
```

---

## 9. `lock.json` — Legacy Coordination (Reserved)

**Path:** `.agentxchain/lock.json`
**Writer:** Legacy (non-governed) protocol path only
**Status:** Reserved path. Listed in `ASSIGNMENT.json.reserved_paths`. Not used in governed mode.

```typescript
interface LockFile {
  holder: string | null;
  turn_number: number;
  last_released_by: string | null;
  claimed_at: string | null;                  // ISO 8601.
}
```

---

## 10. Gate Definition (Config Fragment)

**Location:** `agentxchain.json` → `gates` section

```typescript
interface GateDefinition {
  requires_files?: string[];                  // File paths that must exist.
  requires_verification_pass?: boolean;       // Normalized verification must be "pass" or "attested_pass".
  requires_human_approval?: boolean;          // Gate passes structurally but needs human sign-off.
}
```

---

## 11. Operational Path Classification

These paths are excluded from actor attribution in observed artifacts:

```typescript
// Orchestrator dispatch/staging paths (prefix match)
const OPERATIONAL_PATH_PREFIXES = [
  ".agentxchain/dispatch/",
  ".agentxchain/staging/",
];

// Orchestrator state files (exact match)
const ORCHESTRATOR_STATE_FILES = [
  ".agentxchain/state.json",
  ".agentxchain/history.jsonl",
  ".agentxchain/decision-ledger.jsonl",
  ".agentxchain/lock.json",
];

// Paths writable by review_only roles
const ALLOWED_REVIEW_PATHS = [
  ".planning/*",
  ".agentxchain/reviews/*",
];
```

---

## 12. ID Formats

| ID | Format | Example | Generator |
|---|---|---|---|
| `run_id` | `run_` + 8 random hex chars | `run_a1b2c3d4` | `initializeGovernedRun()` |
| `turn_id` | `turn_` + 8 random hex chars | `turn_e5f6a7b8` | `assignGovernedTurn()` |
| Decision ID | `DEC-` + digits | `DEC-001`, `DEC-042` | Agent (in turn result) |
| Objection ID | `OBJ-` + digits | `OBJ-001`, `OBJ-007` | Agent (in turn result) |

All timestamps use ISO 8601 format via `new Date().toISOString()`.

---

## 13. Data Flow Summary

```
                         ┌──────────────────────┐
                         │   agentxchain.json    │
                         │   (config, frozen)    │
                         └──────────┬───────────┘
                                    │
  ┌─────────────────────────────────┼─────────────────────────────────┐
  │                                 │                                 │
  ▼                                 ▼                                 ▼
ASSIGN                          DISPATCH                          ACCEPT
governed-state.js               dispatch-bundle.js               governed-state.js
  │                                 │                                 │
  ├─► state.json                    ├─► ASSIGNMENT.json               ├─► state.json
  │   (current_turn set)            ├─► PROMPT.md                     ├─► history.jsonl
  │                                 └─► CONTEXT.md                    ├─► decision-ledger.jsonl
  │                                                                   └─► TALK.md
  │                                     ┌─────────┐
  │                                     │  AGENT   │
  │                                     │ (turn)   │
  │                                     └────┬─────┘
  │                                          │
  │                                          ▼
  │                                  STAGE: turn-result.json
  │                                          │
  │                                          ▼
  │                                  VALIDATE (5 stages)
  │                                          │
  │                                          ▼
  │                                  GATE EVALUATE
  │                                  gate-evaluator.js
  │                                          │
  │                              ┌───────────┼───────────┐
  │                              ▼           ▼           ▼
  │                           advance     pause       stay
  │                          (phase++)   (approval)  (gate fail)
  └──────────────────────────────────────────────────────────────────
```

---

## Acceptance Tests

| # | Assertion |
|---|-----------|
| AT-T-01 | `state.json` written by `initializeGovernedRun()` has `schema_version: "1.0"`, `run_id` matching `/^run_[0-9a-f]{8}$/`, `status: "active"`, `current_turn: null` |
| AT-T-02 | `CurrentTurn` created by `assignGovernedTurn()` has `attempt: 1`, `status: "running"`, `deadline_at` exactly 20 minutes after `started_at` |
| AT-T-03 | A turn result missing any required field fails Stage A validation |
| AT-T-04 | A turn result with `run_id` not matching `state.run_id` fails Stage B validation |
| AT-T-05 | A `review_only` turn result with non-empty `files_changed` fails Stage C validation |
| AT-T-06 | A `review_only` turn result with empty `objections` fails Stage E validation (challenge requirement) |
| AT-T-07 | `history.jsonl` entry includes both `verification` (agent-raw) and `normalized_verification` (orchestrator-derived) |
| AT-T-08 | `history.jsonl` entry includes `observed_artifact` with `derived_by: "orchestrator"` |
| AT-T-09 | `decision-ledger.jsonl` entry has `status: "accepted"`, `objections_against: []`, `overridden_by: null` on initial creation |
| AT-T-10 | `ASSIGNMENT.json` contains exactly the 4 reserved paths in `reserved_paths` |
| AT-T-11 | `RecoveryDescriptor` for `pending_run_completion` has `turn_retained: false` |
| AT-T-12 | `RecoveryDescriptor` for `escalation:*` has `turn_retained: true` when `current_turn` exists |
| AT-T-13 | `GateResult` with `action: "advance"` has `passed: true` and non-null `next_phase` |
| AT-T-14 | `RunCompletionResult` with `action: "not_final_phase"` has `passed: false` |
| AT-T-15 | `NormalizedVerification` for `local_cli` with pass + machine evidence (all exit 0) returns `status: "pass"`, `reproducible: true` |
| AT-T-16 | `NormalizedVerification` for `manual` with pass returns `status: "attested_pass"`, `reproducible: false` |

---

## Open Questions

1. **`run_completion_request` missing from JSON schema.** The field is used by `acceptGovernedTurn()`, rendered in the dispatch template, and documented in PROMPT.md — but `turn-result.schema.json` does not include it and has `additionalProperties: false`. Should we add it to the schema now, or wait until the custom validator enforces additionalProperties?

2. **`objections_against` / `overridden_by` in decision-ledger are never back-filled.** When a future turn raises an objection referencing a prior decision, the ledger entry for that decision is not updated. Should v1.1 implement back-fill on acceptance, or should this be a read-time join from objections in history?

3. **`cost` shape in history.jsonl is `{}` when not provided.** The turn result schema makes `cost` optional. The history writer falls back to `turnResult.cost || {}`. Should history normalize this to `{ input_tokens: 0, output_tokens: 0, usd: 0 }` for consistent shape?
