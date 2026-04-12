# Dispatch Bundle Specification — Governed v1

> Normative contract for the filesystem handoff written by `writeDispatchBundle()` before any adapter dispatch.

---

## Purpose

Define the exact bundle the orchestrator materializes for an assigned turn. This is the handoff boundary between governed state/routing and adapter execution. Every adapter consumes the same bundle; none of them re-derive assignment or prompt context for themselves.

This spec is descriptive of the current implementation in `cli/src/lib/dispatch-bundle.js` and the coverage in `cli/test/dispatch-bundle.test.js`.

---

## Interface/Schema

### Library Return Shape

```ts
type DispatchBundleResult =
  | { ok: true; bundlePath: string; warnings?: string[] }
  | { ok: false; error: string };
```

`warnings` is additive, not fatal. It is used when the bundle is written successfully but advisory context had to be degraded, such as an unreadable role prompt file or an unreadable history entry.

### Bundle Location

```text
.agentxchain/dispatch/turns/<turn_id>/
```

Each turn gets its own isolated dispatch directory. The directory contains exactly three orchestrator-authored files:

| File | Format | Purpose |
|------|--------|---------|
| `ASSIGNMENT.json` | JSON | Machine-readable turn envelope |
| `PROMPT.md` | Markdown | Rendered role prompt with protocol rules and JSON output template |
| `CONTEXT.md` | Markdown | Current run context, last accepted turn summary, blockers, and gate visibility |

> **Compatibility note (v1.1+):** Adapters may write additional adapter-scoped audit artifacts into the same turn-scoped dispatch directory. For example, `api_proxy` preflight tokenization writes `TOKEN_BUDGET.json` and `CONTEXT.effective.md` into `.agentxchain/dispatch/turns/<turn_id>/`. These are adapter-authored, not orchestrator-authored, and do not change the three-file orchestrator contract. The orchestrator's `writeDispatchBundle()` cleans the turn directory before each dispatch, so stale adapter artifacts are removed automatically.

### `ASSIGNMENT.json`

```ts
type AssignmentBundle = {
  run_id: string;
  turn_id: string;
  phase: string;
  role: string;
  runtime_id: string;
  write_authority: "authoritative" | "proposed" | "review_only";
  accepted_integration_ref: string | null | undefined;
  staging_result_path: ".agentxchain/staging/<turn_id>/turn-result.json";
  reserved_paths: string[];
  allowed_next_roles: string[];
  attempt: number;
  deadline_at: string;
};
```

### `PROMPT.md`

`PROMPT.md` is rendered from:

- role title and mandate
- turn identity (`run_id`, `turn_id`, `phase`, `attempt`, `runtime_id`)
- protocol rules
- write-authority-specific constraints
- current phase exit-gate requirements
- retry context from `current_turn.last_rejection` when present
- optional role-specific prompt file from `config.prompts[roleId]`
- a full JSON turn-result template
- field-level output rules

### `CONTEXT.md`

`CONTEXT.md` contains:

- current run state summary
- budget spent / remaining when available
- last accepted turn summary, decisions, and objections when history exists
- cumulative decision history from `decision-ledger.jsonl` (agent-authored decisions only, up to 50 most recent, rendered as a markdown table with ID/Phase/Role/Statement columns)
- current blocker or escalation when present
- gate-required file existence checks for the current phase
- phase gate status table

---

## Behavior

### 1. Write Preconditions

`writeDispatchBundle(root, state, config)` only succeeds when:

- `state.current_turn` exists
- `state.current_turn.assigned_role` resolves to a configured role

The bundle writer is not an assignment function. It consumes already-assigned state.

### 2. Bundle Replacement

Before writing a new bundle, the orchestrator deletes the existing turn-scoped dispatch directory (`.agentxchain/dispatch/turns/<turn_id>/`) recursively and recreates it. Stale files are not preserved across redispatches of the same turn.

### 3. Assignment Envelope Rules

`ASSIGNMENT.json` is the adapter-facing truth for:

- which turn is active
- which runtime should execute it
- which next-role proposals are legal in the current phase
- where the staged turn result must be written
- which paths remain orchestrator-reserved
- which attempt number and deadline apply to the dispatch

### 4. Prompt Rendering Rules

`PROMPT.md` MUST include:

1. Identity block for the assigned role
2. Protocol rules, including the challenge requirement and reserved paths
3. Write-authority-specific limits
4. Phase exit gate visibility
5. Retry diagnostics when the turn is a redispatch
6. A complete JSON turn-result template with live `run_id`, `turn_id`, `role`, and `runtime_id`
7. Field rules for `phase_transition_request` and `run_completion_request`

For `review_only` roles, the prompt MUST say that:

- product/code files may not be modified
- the artifact type must be `review`
- `objections` must be non-empty

For `authoritative` roles, the prompt MUST say that:

- repository files may be modified directly
- the artifact type should be `workspace` or `commit`
- all changed files must be declared accurately

### 5. Role-Specific Prompt Files

If `config.prompts[roleId]` points to an existing file, its contents are appended under `## Role-Specific Instructions`.

If the prompt file is missing, bundle generation still succeeds silently.

If the prompt file exists but is unreadable, bundle generation still succeeds but returns a warning describing the unreadable file.

### 6. Context Rendering Rules

`CONTEXT.md` is advisory context, not a validation contract. It is generated from current state plus the last accepted history entry.

Important current behavior:

- if no history exists, the last-turn section is omitted
- if no budget exists, budget lines are omitted
- gate-required files are rendered with `exists` / `MISSING`
- blockers and escalations are surfaced when state carries them
- if `history.jsonl` exists but cannot be parsed, the last-turn section is omitted and the writer returns a warning

### 7. Redispatch Semantics

When a failed or retrying turn is redispatched, the bundle preserves:

- the same `turn_id`
- the current `attempt`
- the rejection reason, failed stage, and validation errors in `PROMPT.md`

The bundle therefore carries retry context forward without mutating assignment identity.

---

## Error Cases

- If `state.current_turn` is missing, bundle creation fails.
- If `state.current_turn.assigned_role` does not exist in config, bundle creation fails.
- If the previous bundle cannot be removed, the writer retries via forced recursive removal; fatal filesystem errors fail the call.
- Missing role-specific prompt files do not fail the bundle.
- Unreadable role-specific prompt files do not fail the bundle, but they return a warning.
- Missing history or gate-required files do not fail the bundle; they are rendered as absent context instead.
- Unreadable `history.jsonl` does not fail the bundle, but it returns a warning and omits last-turn context.

---

## Acceptance Tests

1. `writeDispatchBundle()` without an active turn fails with a clear error.
2. Successful bundle generation writes `ASSIGNMENT.json`, `PROMPT.md`, and `CONTEXT.md`.
3. `ASSIGNMENT.json` contains the live `run_id`, `turn_id`, `runtime_id`, allowed next roles, attempt, and deadline.
4. `PROMPT.md` includes mandate, protocol rules, reserved paths, and the staging output path.
5. `PROMPT.md` includes `review_only` constraints for PM roles.
6. `PROMPT.md` includes `authoritative` constraints for dev roles.
7. `PROMPT.md` includes gate requirements for the current phase.
8. `PROMPT.md` includes retry context when `attempt > 1`.
9. `CONTEXT.md` includes run state, budget, gate-required files, and gate status.
10. `CONTEXT.md` includes cumulative decision history from `decision-ledger.jsonl` when agent-authored decisions exist.
11. Writing a new bundle removes stale files from the previous bundle.
12. Existing custom prompt files are injected under `## Role-Specific Instructions`.
13. Missing custom prompt files do not break bundle generation.
14. The JSON template inside `PROMPT.md` carries the live `run_id`, `turn_id`, `role`, and `runtime_id`.
15. The prompt documents both `phase_transition_request` and `run_completion_request` as mutually exclusive.
16. Unreadable custom prompt files return a warning while preserving bundle generation.
17. Unreadable `history.jsonl` returns a warning while preserving bundle generation.

---

## Open Questions

1. ~~Should v1.1 retain per-turn historical dispatch bundles?~~ **Resolved:** v1.1 uses turn-scoped dispatch directories (`.agentxchain/dispatch/turns/<turn_id>/`), so each turn's bundle is naturally preserved.
2. Should unresolved objections and acceptance-criteria excerpts become first-class sections in `CONTEXT.md`, rather than only whatever is recoverable from the last accepted turn and planning files today?
