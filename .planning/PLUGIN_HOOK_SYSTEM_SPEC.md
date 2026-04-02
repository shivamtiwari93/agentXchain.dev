# Plugin / Hook System Spec

> v2 extension architecture for AgentXchain governed orchestration

---

## Purpose

Enable organizations to inject custom logic at defined lifecycle points without forking the core protocol. Hooks extend governance — they do not replace it. The orchestrator remains the authority; hooks are advisors or gatekeepers within boundaries the orchestrator enforces.

---

## Design Principles

1. **Hooks cannot silently mutate accepted turn history.** History is append-only and orchestrator-owned. A hook that needs to annotate a turn does so via a separate `hook_annotations` ledger, never by modifying `history.jsonl`.
2. **Hooks are declared in config, not discovered at runtime.** No plugin scanning, no dynamic loading from network, no implicit registration. If it's not in `agentxchain.json`, it doesn't run.
3. **Every hook invocation is audited.** The orchestrator records what hook ran, what it received, what it returned, and how the orchestrator acted on the result. This is a first-class audit artifact, not a debug log.
4. **Hooks are synchronous and time-bounded.** No background daemons, no long-polling, no callback registrations. A hook runs, returns a verdict, and exits. Timeout enforcement is the orchestrator's responsibility.
5. **Blocking hooks can stop a lifecycle transition. Advisory hooks cannot.** The distinction is declared in config, not inferred from hook behavior.

---

## Hook Phases

Eight lifecycle hooks, each with a defined trigger point, input contract, and allowed verdict set.

| Phase | Trigger Point | Blocking? | Can Mutate State? |
|-------|--------------|-----------|-------------------|
| `before_assignment` | After role selection, before `assignGovernedTurn()` | Yes | No |
| `after_dispatch` | After dispatch bundle is written, before adapter runs | Yes | Bundle only (append) |
| `before_validation` | After staged result exists, before 5-stage pipeline | Yes | No |
| `after_validation` | After 5-stage pipeline completes, before accept/reject decision | Yes | No |
| `before_acceptance` | After validation passes, before `acceptGovernedTurn()` commits | Yes | No |
| `after_acceptance` | After full acceptance transaction commits (history + ledger + state + journal) | No | No |
| `before_gate` | Before `approve-transition` or `approve-completion` executes | Yes | No |
| `on_escalation` | When run is about to enter blocked state | No | No |

### Why these eight and not more

These map 1:1 to the lifecycle boundaries in `step.js` and `governed-state.js`. Adding hooks mid-pipeline (e.g., between validation stages A and B) would couple the hook API to the validator's internal sequencing — a brittle contract. If an organization needs per-stage validation hooks, they should implement a `before_validation` hook that runs their own validation and returns `block` on failure.

### Why no `before_dispatch` hook

The dispatch bundle is the orchestrator's contract with the agent. Allowing a hook to modify the bundle *before* it's written would let third-party code alter the protocol rules, prompt, or context an agent receives — effectively overriding the orchestrator's authority. `after_dispatch` allows *appending* supplementary files to the bundle directory (e.g., org-specific guidelines), but cannot modify ASSIGNMENT.json, PROMPT.md, or CONTEXT.md.

---

## Configuration Schema

```json
{
  "hooks": {
    "before_assignment": [
      {
        "name": "compliance-gate",
        "type": "process",
        "command": ["./hooks/compliance-check.sh"],
        "timeout_ms": 5000,
        "mode": "blocking",
        "env": { "COMPLIANCE_ENDPOINT": "https://internal.example.com/api" }
      }
    ],
    "after_acceptance": [
      {
        "name": "slack-notify",
        "type": "process",
        "command": ["node", "./hooks/notify-slack.js"],
        "timeout_ms": 3000,
        "mode": "advisory"
      }
    ]
  }
}
```

### Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier within the phase. Pattern: `^[a-z0-9_-]+$` |
| `type` | enum | Yes | `"process"` (v2 only — shell subprocess). Future: `"wasm"`, `"http"` |
| `command` | string[] | Yes | Argv array. First element is the executable (resolved via `PATH` or as a project-root-relative path). Remaining elements are arguments. No shell interpretation — no pipes, no globbing, no `&&`. |
| `timeout_ms` | integer | Yes | Maximum execution time. Range: 100–30000. No default — must be explicit |
| `mode` | enum | Yes | `"blocking"` or `"advisory"`. Must match phase's blocking capability |
| `env` | object | No | Additional environment variables passed to the process |

### Validation Rules

- A hook declared as `"blocking"` on a phase that is `Blocking? = No` is a config error (caught at `init` / `validate`)
- A hook declared as `"advisory"` on a blocking phase is allowed — it simply cannot stop the transition
- Hook names must be unique within a phase
- `command` must be a non-empty array of strings. The first element (executable) must resolve to an existing file via `PATH` lookup or as a project-root-relative path at config validation time
- Maximum 8 hooks per phase (prevent cascading timeout accumulation)

---

## Input Contract (stdin)

The orchestrator passes a JSON payload to the hook process on **stdin**. The hook reads stdin, processes, and writes its verdict to **stdout**.

### Common Envelope

Every hook receives:

```json
{
  "hook_phase": "before_assignment",
  "hook_name": "compliance-gate",
  "run_id": "run_abc123",
  "project_root": "/path/to/project",
  "timestamp": "2026-04-02T15:00:00.000Z",
  "payload": { /* phase-specific */ }
}
```

### Phase-Specific Payloads

**`before_assignment`**
```json
{
  "role_id": "dev",
  "role_config": { /* role definition from agentxchain.json */ },
  "phase": "implementation",
  "active_turns": [],
  "history_length": 3
}
```

**`after_dispatch`**
```json
{
  "turn_id": "turn_xyz789",
  "role_id": "dev",
  "bundle_path": ".agentxchain/dispatch/turns/turn_xyz789/",
  "bundle_files": ["ASSIGNMENT.json", "PROMPT.md", "CONTEXT.md"]
}
```

**`before_validation`**
```json
{
  "turn_id": "turn_xyz789",
  "role_id": "dev",
  "staging_path": ".agentxchain/staging/turn_xyz789/turn-result.json",
  "turn_result": { /* raw parsed JSON from staging */ },
  "parse_error": "Unexpected token ...",
  "read_error": null
}
```

`turn_result` is `null` when the staged file exists but cannot be parsed. `parse_error` or `read_error` is included only when that failure occurred.

**`after_validation`**
```json
{
  "turn_id": "turn_xyz789",
  "role_id": "dev",
  "validation_ok": true,
  "validation_stage": null,
  "errors": [],
  "warnings": ["authoritative turn with no files_changed"],
  "turn_result": { /* validated turn result */ }
}
```

`validation_stage` is the failing stage (`schema`, `assignment`, `artifact`, `verification`, `protocol`) when validation fails, and `null` when the full pipeline passes.

**`before_acceptance`**
```json
{
  "turn_id": "turn_xyz789",
  "role_id": "dev",
  "turn_result": { /* validated turn result */ },
  "observed_changes": { "added": [], "modified": ["src/auth.ts"], "deleted": [] },
  "conflict_detected": false
}
```

**`after_acceptance`** (fires after the full acceptance transaction — history, ledger, talk, and state are all committed)
```json
{
  "turn_id": "turn_xyz789",
  "role_id": "dev",
  "history_entry_index": 4,
  "accepted_integration_ref": "abc1234",
  "decisions_count": 2,
  "objections_count": 1,
  "run_status": "active",
  "phase": "implementation"
}
```

**`before_gate`**
```json
{
  "gate_type": "phase_transition" | "run_completion",
  "current_phase": "implementation",
  "target_phase": "qa",
  "gate_config": { /* from agentxchain.json phases */ },
  "history_length": 5
}
```

**`on_escalation`**
```json
{
  "blocked_reason": "retry_exhaustion",
  "recovery_action": "reassign",
  "failed_turn_id": "turn_xyz789",
  "failed_role": "dev",
  "attempt_count": 3,
  "last_error": "verification_error"
}
```

---

## Output Contract (stdout)

The hook writes a single JSON object to stdout.

### Verdict Schema

```json
{
  "verdict": "allow" | "warn" | "block",
  "message": "Human-readable explanation (required for warn and block)",
  "annotations": [
    {
      "key": "compliance_ticket",
      "value": "COMP-4521"
    }
  ]
}
```

| Verdict | Effect on blocking hooks | Effect on advisory hooks |
|---------|-------------------------|------------------------|
| `allow` | Lifecycle continues | Lifecycle continues |
| `warn` | Lifecycle continues, warning recorded in audit | Lifecycle continues, warning recorded in audit |
| `block` | Lifecycle halts, run enters blocked state with hook context | N/A — advisory hooks cannot block (verdict downgraded to `warn` with audit note) |

### Annotations

Hooks can attach key-value annotations that are recorded in the hook audit log. These are metadata (compliance ticket IDs, risk scores, reviewer identifiers) — not state mutations.

- Keys must match `^[a-z0-9_-]+$`
- Values must be strings, max 1000 characters
- Max 16 annotations per verdict
- Annotations from `after_acceptance` hooks are also appended to the `hook_annotations` ledger (separate from `history.jsonl`)

---

## Execution Semantics

### Ordering

Hooks within a phase execute **sequentially** in config declaration order. A blocking hook that returns `block` short-circuits — remaining hooks in that phase do not run.

### State impact of a blocking verdict

A blocking verdict aborts the **current operation**. It does not automatically mean the orchestrator persists `state.status = "blocked"` for every phase.

- `before_assignment`: aborts the attempted assignment and leaves the existing run state unchanged. This avoids freezing unrelated already-active turns when a policy hook vetoes an additional assignment. The audit log is the canonical record of the veto.
- `before_acceptance`, `before_gate`, and equivalent pre-commit/pre-gate lifecycle checkpoints: may persist blocked state when the operator must resolve the issue before the workflow can continue.
- Any protected-file tamper (`hook_state_tamper`, `hook_history_tamper`, `hook_ledger_tamper`, `hook_bundle_tamper`) always fails closed and persists blocked state or post-commit blocked recovery, because the orchestrator can no longer trust the affected artifact.

### Timeout

If a hook exceeds `timeout_ms`:
1. The orchestrator terminates the subprocess when the timeout budget is exceeded.
2. In the v2 prototype this is implemented with synchronous process timeout semantics; strict SIGTERM then SIGKILL escalation is deferred until hook execution moves to an async runner.
3. Timeout is treated as:
   - `block` verdict for blocking hooks (fail-closed)
   - `warn` verdict for advisory hooks
4. Audit log records the timeout with process exit state

### Process Failure

If the hook process exits non-zero without writing valid JSON to stdout:
- Same treatment as timeout: fail-closed for blocking, warn for advisory
- stderr content (up to 4KB) is captured in the audit log

### Environment

The hook process receives:
- `AGENTXCHAIN_HOOK_PHASE` — the phase name
- `AGENTXCHAIN_HOOK_NAME` — the hook name from config
- `AGENTXCHAIN_RUN_ID` — current run ID
- `AGENTXCHAIN_PROJECT_ROOT` — absolute project root path
- Any additional env vars from the hook's `env` config
- The hook's working directory is the project root
- stdin is the JSON payload
- stdout is the JSON verdict
- stderr is captured for audit (not interpreted)

### No Mutation Guarantee

The orchestrator does NOT trust hook processes. Before invoking a hook, the orchestrator captures **SHA-256 content digests** of all protected files. After the hook returns:

1. `state.json` digest is compared to the pre-hook digest. If it differs, the orchestrator aborts with `hook_state_tamper` error.
2. `history.jsonl` digest is compared to the pre-hook digest. If it differs, the orchestrator aborts with `hook_history_tamper` error. (Line-count comparison alone is insufficient — a hook could rewrite entries in place without changing the number of lines.)
3. `decision-ledger.jsonl` digest is compared to the pre-hook digest. If it differs, the orchestrator aborts with `hook_ledger_tamper` error.
4. `after_dispatch` bundle appends are allowed only in a `hook_supplements/` subdirectory within the bundle path. Core bundle files (`ASSIGNMENT.json`, `PROMPT.md`, `CONTEXT.md`, `CONTEXT.effective.md`) are digest-protected — any modification is detected and rejected as `hook_bundle_tamper`.

Post-commit semantics for `after_acceptance` are explicit: if tamper is detected after the acceptance transaction has already committed, the accepted turn remains in `history.jsonl`, but the run immediately enters `blocked` state and the command exits non-zero. AgentXchain must fail closed without pretending the hook issue was harmless.

Protected file set: `state.json`, `history.jsonl`, `decision-ledger.jsonl`, and all core dispatch bundle files. The digest algorithm is SHA-256 computed over the raw file bytes. Digests are computed synchronously before the hook spawns and verified synchronously after the hook process exits.

---

## Audit Trail

### Hook Audit Log

File: `.agentxchain/hook-audit.jsonl`

Each hook invocation appends one line:

```json
{
  "timestamp": "2026-04-02T15:00:01.234Z",
  "hook_phase": "before_acceptance",
  "hook_name": "compliance-gate",
  "run_id": "run_abc123",
  "turn_id": "turn_xyz789",
  "duration_ms": 342,
  "verdict": "allow",
  "message": null,
  "annotations": [{ "key": "compliance_ticket", "value": "COMP-4521" }],
  "exit_code": 0,
  "timed_out": false,
  "stderr_excerpt": "",
  "orchestrator_action": "continued"
}
```

### Hook Annotations Ledger

File: `.agentxchain/hook-annotations.jsonl`

Only populated by `after_acceptance` hooks. Each entry associates annotations with a committed turn:

```json
{
  "timestamp": "2026-04-02T15:00:02.567Z",
  "turn_id": "turn_xyz789",
  "hook_name": "compliance-gate",
  "annotations": [{ "key": "compliance_ticket", "value": "COMP-4521" }]
}
```

This is a separate ledger from `history.jsonl` by design. Turn history records what happened. Hook annotations record what external systems said about what happened. Merging them would let a hook backdoor compliance metadata into the canonical turn record.

### Repo Observer Classification

Both `hook-audit.jsonl` and `hook-annotations.jsonl` are **orchestrator-owned state files**. They are written exclusively by the orchestrator's hook execution engine, never by agents. The repo observer (`repo-observer.js`) must classify them as orchestrator state — not as product files — to prevent false-positive artifact mismatch errors when agents with restricted roles (e.g., `review_only`) participate in governed turns where hooks fire.

Normative requirement: any file under `.agentxchain/` that is written by the orchestrator's hook lifecycle must be listed in `ORCHESTRATOR_STATE_FILES` in the repo observer. Failure to do so will cause the repo observer to misattribute hook-written files to the agent, breaking role-based acceptance validation.

This was discovered as a composition bug when the E2E hook lifecycle test (Scenario C) triggered `after_acceptance` hooks during a `review_only` agent's turn. The hook wrote to `hook-annotations.jsonl`, the repo observer classified it as a product file, and acceptance failed with `Observed artifact mismatch`. The fix was adding both ledger paths to `ORCHESTRATOR_STATE_FILES`. See `DEC-HOOK-COMP-001`.

---

## Error Cases

| Scenario | Behavior |
|----------|----------|
| Hook config references non-existent command | Config validation error at `init` / `validate` |
| Hook timeout_ms out of range | Config validation error |
| Blocking hook on non-blocking phase | Config validation error |
| Duplicate hook name within phase | Config validation error |
| Hook exceeds timeout | SIGTERM → SIGKILL, fail-closed (blocking) or warn (advisory) |
| Hook exits non-zero | Fail-closed (blocking) or warn (advisory), stderr captured |
| Hook writes invalid JSON to stdout | Treated as process failure |
| Hook writes valid JSON with unknown verdict value | Treated as process failure |
| Hook modifies state.json during execution | `hook_state_tamper` error (digest mismatch), lifecycle aborted |
| Hook modifies history.jsonl during execution | `hook_history_tamper` error (digest mismatch), lifecycle aborted |
| Hook modifies decision-ledger.jsonl during execution | `hook_ledger_tamper` error (digest mismatch), lifecycle aborted |
| Hook modifies dispatch bundle core files | `hook_bundle_tamper` error (digest mismatch), dispatch aborted |
| Multiple hooks block in same phase | First blocker wins (short-circuit), remaining hooks don't run |

---

## Acceptance Tests

### AT-HOOK-001: Blocking hook stops lifecycle
Given a `before_acceptance` hook configured as blocking that returns `{"verdict": "block", "message": "Compliance review required"}`, when `accept-turn` is invoked, then the turn is NOT committed to history, the run enters blocked state with `hook_block` reason, and the hook audit log records the block verdict.

### AT-HOOK-002: Advisory hook cannot block
Given an `after_acceptance` hook configured as advisory that returns `{"verdict": "block", "message": "..."}`, when `accept-turn` is invoked, then the turn IS committed to history, the audit log records the verdict was downgraded from `block` to `warn`, and a warning is emitted.

### AT-HOOK-003: Hook timeout fails closed
Given a `before_validation` blocking hook with `timeout_ms: 1000` that sleeps for 5 seconds, when the hook is invoked, then the process is killed, the lifecycle halts, and the audit log records `timed_out: true`.

### AT-HOOK-004: Hook state tamper detection
Given any hook that writes to `.agentxchain/state.json` during execution, when the orchestrator resumes after the hook, then it detects the state mismatch and aborts with `hook_state_tamper`.

### AT-HOOK-005: Hook annotations are separate from history
Given an `after_acceptance` hook that returns annotations, when the turn is accepted, then annotations appear in `hook-annotations.jsonl` and NOT in `history.jsonl`.

### AT-HOOK-006: after_dispatch bundle append
Given an `after_dispatch` hook that writes `hook_supplements/guidelines.md` in the bundle directory, when the dispatch bundle is finalized, then the supplement file exists in the bundle AND `ASSIGNMENT.json`, `PROMPT.md`, `CONTEXT.md` are unchanged.

### AT-HOOK-007: after_dispatch bundle tamper
Given an `after_dispatch` hook that modifies `PROMPT.md` in the bundle directory, when the orchestrator resumes, then it detects the modification and aborts with `hook_bundle_tamper`.

### AT-HOOK-008: Hook ordering and short-circuit
Given two blocking hooks on `before_acceptance` where the first returns `block`, when acceptance is attempted, then only the first hook runs, the second is skipped, and the audit log records both the block and the skip.

### AT-HOOK-009: Config validation catches bad hook definitions
Given a config with a blocking hook on `after_acceptance` (non-blocking phase), when `agentxchain validate` runs, then it reports a config error.

### AT-HOOK-010: Process failure captured
Given a hook whose command exits with code 1 and writes "panic: null pointer" to stderr, when the hook runs, then the audit log captures the exit code and stderr excerpt.

---

## Open Questions

### OQ-HOOK-001: Should `before_gate` hooks be able to auto-approve gates?
Current spec says hooks can `allow`, `warn`, or `block`. But a natural extension is letting a `before_gate` hook return `auto_approve` — e.g., if all compliance checks pass, skip the human gate. This would be a significant governance change (hooks could bypass human authority). Proposal: **No for v2.** Human gates are constitutional. Hooks can block a gate but not approve one. Revisit in v3 if organizations demonstrate safe auto-approval patterns.

### OQ-HOOK-002: Should hooks see the full history?
Current payloads include `history_length` but not the full history. Passing full history to every hook could be expensive (large payloads) and leak information across organizational boundaries (if hooks are third-party). Proposal: hooks that need history can read `history.jsonl` directly from the project root (which they receive). The orchestrator should not pre-serialize it.

### OQ-HOOK-003: Remote hook type (`"http"`)
The spec defines only `"process"` hooks. An `"http"` hook type would POST the payload to a URL and read the verdict from the response. This enables cloud-hosted compliance services. Concerns: latency, authentication, payload confidentiality. Proposal: defer to v2.1. The `"process"` type covers the common case (local scripts, CLI tools). Organizations needing HTTP hooks can implement a thin process wrapper that calls their service.

### OQ-HOOK-004: Hook dependency chains
Should hooks within a phase be able to declare dependencies on other hooks' verdicts? E.g., "run the SAST scanner only if the license checker passes." Current spec says: sequential execution, first-block-wins. That's simple and sufficient. Dependency chains add complexity without clear justification yet.

### OQ-HOOK-005: Wasm hook type
A `"wasm"` hook type would run hooks in a sandboxed Wasm runtime, eliminating filesystem access concerns and making tamper detection unnecessary for that hook type. This is architecturally attractive but adds a runtime dependency. Proposal: evaluate for v3.
