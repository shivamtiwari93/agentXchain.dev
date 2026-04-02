# Preemptive Tokenization Spec

> Post-v1 additive contract for preventing predictable `api_proxy` context overflow before an API request is sent.

---

## Purpose

Define the v1.1 preflight token-budget behavior for `api_proxy` runtimes.

Goals:

- detect likely context overflow locally before the provider call
- keep the governed turn model unchanged
- preserve auditability when context is compressed
- reduce operator friction without silently mutating the core prompt contract

This spec is intentionally narrower than "context splitting." In v1.1, one governed turn still maps to one provider request. If the request cannot fit after bounded context compression, the adapter fails locally and surfaces recovery guidance without making the API call.

---

## Interface/Schema

### Scope

This spec applies only to `api_proxy` runtimes.

- `manual` and `local_cli` are out of scope in v1.1
- current provider scope remains `anthropic`

### Runtime Config Extension

`api_proxy` runtimes may add an optional `context_window_tokens` field plus an optional `preflight_tokenization` block:

```json
{
  "type": "api_proxy",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "auth_env": "ANTHROPIC_API_KEY",
  "max_output_tokens": 4096,
  "timeout_seconds": 120,
  "context_window_tokens": 200000,
  "preflight_tokenization": {
    "enabled": true,
    "tokenizer": "provider_local",
    "safety_margin_tokens": 2048
  }
}
```

```ts
type ApiProxyPreflightTokenization = {
  enabled?: boolean;
  tokenizer?: "provider_local";
  safety_margin_tokens?: number;
};
```

Validation rules:

- when `preflight_tokenization.enabled !== true`, v1 behavior is unchanged
- when `preflight_tokenization.enabled === true`:
  - `context_window_tokens` is REQUIRED and must be a positive integer
  - `tokenizer` defaults to `"provider_local"`
  - `safety_margin_tokens` defaults to `2048`
  - `safety_margin_tokens` must be `>= 0`
  - `context_window_tokens` must be greater than `max_output_tokens + safety_margin_tokens`

### Token Budget Formula

The adapter computes:

```ts
reserved_output_tokens = runtime.max_output_tokens || 4096;
available_input_tokens =
  context_window_tokens - reserved_output_tokens - safety_margin_tokens;
```

The request may proceed only when the estimated input tokens for the exact outbound payload are `<= available_input_tokens`.

### Counting Boundary

The estimate MUST include all input-bearing text that will be sent to the provider:

- the `system` field: the adapter-authored system prompt (fixed 4-line string in `buildAnthropicRequest`)
- the `messages[0].content` field, which is assembled as:
  - `PROMPT.md` full text
  - the separator `\n\n---\n\n` (when context exists)
  - the effective context markdown actually sent after any compression

The estimate MUST NOT rely on the provider response or any network-side token counting endpoint. The separator is small but must be counted for correctness.

### Tokenizer Selection

v1.1 freezes the tokenizer strategy as:

- `provider_local` only

This means the token counter must track the provider request format actually used by `api_proxy`. For the current Anthropic-only runtime surface, the implementation must use an Anthropic-specific local tokenizer path. A generic `tiktoken`-style fallback is explicitly rejected for the default guardrail because the overflow check must be provider-aligned, not merely heuristic.

Current implementation direction for Anthropic: use the official `@anthropic-ai/tokenizer` package behind a small AgentXchain wrapper. The exact package version is pinned in `cli/package.json` so fresh installs do not silently drift the guardrail behavior.

### Audit Artifacts

When preflight tokenization is enabled, the adapter writes two best-effort audit artifacts into the turn-scoped dispatch directory:

```text
.agentxchain/dispatch/turns/<turn_id>/
```

1. `TOKEN_BUDGET.json`
2. `CONTEXT.effective.md`

`CONTEXT.effective.md` is the exact context markdown actually sent to the provider after compression. The original orchestrator-authored `CONTEXT.md` remains unchanged.

### `TOKEN_BUDGET.json`

```ts
type TokenBudgetReport = {
  provider: string;
  model: string;
  runtime_id: string;
  run_id: string;
  turn_id: string;
  tokenizer: "provider_local";
  context_window_tokens: number;
  reserved_output_tokens: number;
  safety_margin_tokens: number;
  available_input_tokens: number;
  system_prompt_tokens: number;
  prompt_tokens: number;
  separator_tokens: number;
  original_context_tokens: number;
  final_context_tokens: number;
  estimated_input_tokens: number;
  truncated: boolean;
  sent_to_provider: boolean;
  effective_context_path: ".agentxchain/dispatch/turns/<turn_id>/CONTEXT.effective.md";
  sections: Array<{
    id:
      | "current_state"
      | "budget"
      | "last_turn_header"
      | "last_turn_summary"
      | "last_turn_decisions"
      | "last_turn_objections"
      | "blockers"
      | "escalation"
      | "gate_required_files"
      | "phase_gate_status";
    required: boolean;
    original_tokens: number;
    final_tokens: number;
    action: "kept" | "truncated" | "dropped";
  }>;
};
```

---

## Behavior

### 1. Trigger Point

Preflight tokenization runs inside `dispatchApiProxy()` after the dispatch bundle has been written and before the HTTP request is sent.

It does not:

- create a new governed turn
- mutate `state.current_turn.attempt`
- append history
- rewrite orchestrator-authored dispatch bundle files

### 2. Non-Compressible Material

The following material is immutable for preflight purposes:

- the adapter system prompt
- `PROMPT.md` in full
- retry context embedded in `PROMPT.md`
- the JSON output template and field rules in `PROMPT.md`

v1.1 may compress only context, never the prompt contract itself.

### 3. Context Section Parsing

`CONTEXT.md` is rendered by the orchestrator as a flat markdown string. The preflight tokenizer must parse it back into structured sections using the `## ` header boundaries and bullet-list structure. Section IDs are derived from the rendered headers:

| Header in CONTEXT.md | Section ID | Notes |
|---|---|---|
| `## Current State` | `current_state` | Contains budget lines as sub-bullets when `budget_status` exists |
| *(budget lines within Current State)* | `budget` | Not a standalone header — extracted from `current_state` bullet items matching `Budget spent` / `Budget remaining` |
| `## Last Accepted Turn` | `last_turn_header` | The header line plus `Turn:` and `Role:` bullets |
| *(Summary bullet within Last Accepted Turn)* | `last_turn_summary` | The `**Summary:**` bullet |
| *(Decisions list within Last Accepted Turn)* | `last_turn_decisions` | The `**Decisions:**` bullet and its sub-items |
| *(Objections list within Last Accepted Turn)* | `last_turn_objections` | The `**Objections:**` bullet and its sub-items |
| `## Blockers` | `blockers` | Present only when `state.blocked_on` is set |
| `## Escalation` | `escalation` | Present only when `state.escalation` exists |
| `## Gate Required Files` | `gate_required_files` | Present only when phase gate has `requires_files` |
| `## Phase Gate Status` | `phase_gate_status` | Present only when `state.phase_gate_status` exists |

**Important implementation note:** `budget`, `last_turn_summary`, `last_turn_decisions`, and `last_turn_objections` are sub-sections within their parent headers, not standalone `## ` blocks. The parser must handle this nested structure.

### 3a. Compressible Context Sections

The adapter may reduce only these sections:

- `budget` (budget lines within Current State)
- `gate_required_files`
- `phase_gate_status`
- `last_turn_summary`
- `last_turn_decisions`
- `last_turn_objections`

Sticky sections that may not be dropped when present:

- `current_state` (minus budget lines, which are independently compressible)
- `last_turn_header` (`turn_id` and `role` only, when a last accepted turn exists)
- `blockers`
- `escalation`

### 4. Compression Order

When the initial estimate exceeds the available input budget, the adapter compresses in this exact order:

1. drop `budget` (remove budget lines from within Current State)
2. drop `phase_gate_status`
3. drop `gate_required_files`
4. drop `last_turn_objections`
5. drop `last_turn_decisions`
6. truncate `last_turn_summary` to 240 characters
7. drop `last_turn_summary` entirely but keep `last_turn_header`

After each step, the adapter must re-estimate the full outbound input.

This is deliberately bounded and deterministic. v1.1 does not summarize with another model and does not mutate the last-turn facts beyond the one fixed summary truncation threshold.

### 5. Success Path

If the request fits:

- write `CONTEXT.effective.md`
- write `TOKEN_BUDGET.json`
- include the effective context in the provider request
- set `sent_to_provider = true`

If no compression was required, `CONTEXT.effective.md` may match `CONTEXT.md` byte-for-byte. The artifact still provides a stable audit trail for what was actually sent.

### 6. Preflight Overflow Failure

If the request still exceeds the budget after the final compression step:

- do not send any provider request
- write `CONTEXT.effective.md` with the maximally compressed context
- write `TOKEN_BUDGET.json` with `sent_to_provider = false`
- persist the failure through the existing `context_overflow` recovery path

The error message must make clear that overflow was detected locally before any API call. Recovery guidance remains the same:

- reduce prompt/context
- choose a runtime with a larger `context_window_tokens`
- or disable preflight tokenization temporarily if the operator explicitly wants post-hoc provider enforcement instead

### 7. Prompt-Only Failure

If `system prompt + PROMPT.md + sticky minimum context` already exceed the available input budget, the adapter must fail immediately through the same local preflight overflow path. The operator then knows the issue is structural, not caused by expandable historical context.

### 8. CLI Surface

`agentxchain step` should stay concise:

- on fit without compression: optionally print the estimated budget line in verbose mode only
- on fit with compression: print one line naming that context was truncated and the final estimated input budget
- on preflight failure: print that overflow was detected locally and no provider request was made

The existing recovery commands do not change.

### 9. Backward Compatibility

This is a strict additive change.

- Existing `api_proxy` runtimes remain valid when preflight is absent or disabled.
- Existing provider-side `context_overflow` handling remains valid as the fallback when preflight is not enabled.
- `manual` and `local_cli` behavior is unchanged.

---

## Error Cases

- Invalid config:
  `preflight_tokenization.enabled === true` without `context_window_tokens`, negative `safety_margin_tokens`, unsupported `tokenizer`, or an impossible token budget must fail config validation.

- Tokenizer initialization failure:
  if the local provider tokenizer cannot be loaded while preflight is enabled, dispatch must fail closed before any network request. This is not retryable.

- Artifact write failure:
  inability to write `TOKEN_BUDGET.json` or `CONTEXT.effective.md` is best-effort only. Preflight may continue if the token decision itself succeeded.

- Provider mismatch:
  if a future provider is configured without a matching `provider_local` tokenizer implementation, preflight must fail closed rather than silently switching to an approximate tokenizer.

- Compression exhausted:
  if the request still does not fit after the final allowed compression step, return local `context_overflow` failure and do not call `fetch`.

---

## Acceptance Tests

1. A runtime with no `preflight_tokenization` block keeps the current single-request `api_proxy` behavior.
2. Enabling preflight without `context_window_tokens` fails config validation.
3. Enabling preflight with a valid context window and enough budget writes `TOKEN_BUDGET.json`, writes `CONTEXT.effective.md`, and sends exactly one provider request.
4. When the initial request is too large but dropping `budget` and `phase_gate_status` makes it fit, the adapter sends the request and records those sections as `dropped`.
5. When the request still does not fit until `last_turn_decisions` and `last_turn_objections` are removed, the adapter sends the request and records those sections as `dropped`.
6. When the request still does not fit until `last_turn_summary` is truncated, the adapter sends the request and records `last_turn_summary.action = "truncated"`.
7. When the request still exceeds budget after maximum compression, the adapter does not invoke the provider, writes `TOKEN_BUDGET.json` with `sent_to_provider = false`, and returns `context_overflow`.
8. When prompt-only material exceeds the budget, the adapter fails locally without invoking the provider and the report shows near-zero removable context.
9. `PROMPT.md` is never altered by the preflight path.
10. `manual` and `local_cli` runtimes ignore `preflight_tokenization` because the feature is `api_proxy`-only in v1.1.

---

## Open Questions

None blocking v1.1. Two follow-ups are now frozen:

1. `context_window_tokens` remains explicit runtime configuration for v1.1 and the current v1.x line. A curated internal model-window table is deferred until AgentXchain has a stable provider/model registry and a versioning story for provider-side model-window drift.
2. `TOKEN_BUDGET.json` and `CONTEXT.effective.md` remain the authoritative v1.1 token-budget surface. `agentxchain status --json` does not expose token-budget summary in v1.1 because the report is dispatch-scoped, adapter-authored, and ephemeral rather than run-state authority.
