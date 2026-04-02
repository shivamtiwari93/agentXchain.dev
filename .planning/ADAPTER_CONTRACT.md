# Adapter Contract — v1 Spec

> Every adapter type must satisfy the same staging contract. The orchestrator doesn't care how the turn was executed — only that a valid turn result appeared at the staging path.

---

## Purpose

Adapters bridge the gap between the governed orchestrator and the actual agent execution environment. The orchestrator assigns turns; adapters deliver prompts and collect results. This spec defines what every adapter MUST do, what it MUST NOT do, and the contracts between adapter types and the orchestrator.

The key insight: **adapters are classified by write authority, not just transport.** A `manual` adapter and an `api_proxy` adapter can both serve `review_only` roles, but only `local_cli` (or `manual` with human action) can serve `authoritative` roles that modify the repo.

---

## Interface

### Adapter Lifecycle (3-phase)

Every adapter, regardless of type, follows the same three-phase lifecycle:

```
dispatch → wait → collect
```

| Phase | Responsibility | Output |
|-------|---------------|--------|
| **dispatch** | Deliver the prompt/context to the agent execution environment | Dispatch artifacts written to `.agentxchain/dispatch/turns/<turn_id>/` |
| **wait** | Block until the agent produces a result (or timeout/abort) | `{ found, timedOut, aborted }` |
| **collect** | Read the staged turn result without validation | Raw JSON from `.agentxchain/staging/<turn_id>/turn-result.json` |

Validation is NOT the adapter's responsibility. The orchestrator validates after collect.

### Filesystem Contract

All adapters share these paths:

| Path | Purpose | Writer | Reader |
|------|---------|--------|--------|
| `.agentxchain/dispatch/turns/<turn_id>/ASSIGNMENT.json` | Machine-readable turn envelope | Orchestrator (via `writeDispatchBundle`) | Adapter, Agent |
| `.agentxchain/dispatch/turns/<turn_id>/PROMPT.md` | Rendered seed prompt with protocol rules | Orchestrator (via `writeDispatchBundle`) | Adapter, Agent |
| `.agentxchain/dispatch/turns/<turn_id>/CONTEXT.md` | Execution context (state, last turn, gates) | Orchestrator (via `writeDispatchBundle`) | Adapter, Agent |
| `.agentxchain/staging/<turn_id>/turn-result.json` | Structured turn result JSON | Agent (via adapter or manual) | Orchestrator (via `accept-turn`) |

### Reserved Paths

Adapters and agents MUST NOT write to:

- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `.agentxchain/lock.json`

These are orchestrator-owned. Any adapter that writes to these paths violates the protocol.

---

## Adapter Types

### 1. `manual`

**Transport:** Filesystem (human reads prompt from disk, writes result to disk)

**Write authority support:** All (`authoritative`, `proposed`, `review_only`)

**Dispatch phase:**
- Prints operator instructions (box-formatted) showing prompt path and result path
- Does NOT deliver the prompt to any automated system

**Wait phase:**
- Polls `.agentxchain/staging/<turn_id>/turn-result.json` every 2 seconds (configurable)
- Returns when file exists and is >2 bytes (not just `{}`)
- Respects `timeoutMs` (default: 20 minutes) and `AbortSignal`

**Collect phase:**
- Reads and JSON-parses the staged file
- Returns `{ ok, raw, parsed }` or `{ ok: false, error }`

**Config schema:**
```json
{
  "type": "manual"
}
```

No additional fields required.

**Recovery on failure:** Operator fixes the staged file and reruns `agentxchain accept-turn`, or rejects with `agentxchain reject-turn --reason "..."`.

---

### 2. `local_cli`

**Transport:** Subprocess (spawns a CLI command with the prompt)

**Write authority support:** All, but primarily designed for `authoritative` roles that need to modify the repo via tools like `claude --print`.

**Dispatch phase:**
- Reads `PROMPT.md` + `CONTEXT.md` from the dispatch bundle
- Resolves the CLI command from runtime config
- Spawns the subprocess with the prompt delivered via one of three transports:
  - `argv`: `{prompt}` placeholder in command/args is replaced with the full prompt text
  - `stdin`: Prompt written to subprocess stdin
  - `dispatch_bundle_only`: No prompt delivery; subprocess reads from disk
- Clears any previous staged result before spawning

**Wait phase:**
- Waits for subprocess exit
- On exit, checks if `.agentxchain/staging/<turn_id>/turn-result.json` was written
- Subprocess success (exit 0) does NOT mean turn success — only a valid staged result counts

**Collect phase:**
- If staged result exists: returns `{ ok: true }` with exit code and logs
- If no staged result: returns `{ ok: false }` with error describing the gap

**Timeout handling:**
- `SIGTERM` sent at deadline (from `turn.deadline_at` or default 20 min)
- `SIGKILL` sent 10 seconds after `SIGTERM` if process hasn't exited
- Abort signal triggers `SIGTERM` → 5s grace → `SIGKILL`

**Config schema:**
```json
{
  "type": "local_cli",
  "command": ["claude", "--print", "-p", "{prompt}"],
  "cwd": ".",
  "prompt_transport": "argv"
}
```

Alternative config (command + args separated):
```json
{
  "type": "local_cli",
  "command": "claude",
  "args": ["--print", "-p", "{prompt}"],
  "cwd": ".",
  "prompt_transport": "argv"
}
```

**Prompt transport inference:** If `prompt_transport` is not set explicitly:
- If any command/args element contains `{prompt}` → `"argv"`
- Otherwise → `"dispatch_bundle_only"`

**Recovery on failure:**
- `RecoveryDescriptor.typed_reason = "dispatch_error"`
- Operator checks subprocess output (saved to `.agentxchain/dispatch/turns/<turn_id>/stdout.log`)
- Then either stages result manually + `accept-turn`, or `reject-turn`

---

### 3. `api_proxy`

**Transport:** HTTP API call (single request/response, synchronous within `step`)

**Write authority support:** `review_only` ONLY in v1. The adapter enforces this restriction — attempting to dispatch an `authoritative` or `proposed` role via `api_proxy` returns an error.

**Dispatch phase:**
- Reads `PROMPT.md` + `CONTEXT.md` from the dispatch bundle
- Resolves provider, model, and API key from runtime config
- Validates API key is present in environment
- Builds provider-specific request (currently Anthropic only)
- Persists request metadata to `.agentxchain/dispatch/turns/<turn_id>/API_REQUEST.json` (excluding the API key)
- Sends the HTTP request

**Wait phase:**
- Integrated into dispatch (synchronous HTTP call)
- Respects `timeout_seconds` from runtime config (default: 120s)
- Respects `AbortSignal` for external cancellation

**Collect phase:**
- Parses API response
- Persists raw response to `.agentxchain/staging/provider-response.json`
- Extracts structured turn result JSON from response text (tries: raw parse → markdown fence extraction → JSON boundary detection)
- Overwrites `cost` field with provider telemetry (authoritative for billing)
- Stages extracted result at `.agentxchain/staging/<turn_id>/turn-result.json`

**Config schema:**
```json
{
  "type": "api_proxy",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "auth_env": "ANTHROPIC_API_KEY",
  "max_output_tokens": 4096,
  "timeout_seconds": 120
}
```

**Supported providers:** `anthropic` (v1). Adding a new provider requires implementing `buildHeaders()` and `buildRequest()` for that provider's API format.

**Cost tracking:**
Provider telemetry is authoritative. The adapter computes cost from token counts using hardcoded rates:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|------------------------|
| `claude-sonnet-4-6` | $3.00 | $15.00 |
| `claude-opus-4-6` | $15.00 | $75.00 |
| `claude-haiku-4-5-20251001` | $0.80 | $4.00 |

**Recovery on failure:**
- Missing API key: `RecoveryDescriptor.typed_reason = "dispatch_error"`, recovery action names the specific env var
- API error: Error message includes HTTP status and response body (truncated to 500 chars)
- JSON extraction failure: Error message describes what went wrong

---

## Behavior Rules

1. **Adapters MUST NOT write state.** Only the orchestrator advances `state.json`. An adapter that writes state is a protocol violation.

2. **Adapters MUST NOT validate turn results.** Validation is the orchestrator's job (via `accept-turn` → `validateGovernedTurnResult()`). Adapters only stage the raw result.

3. **Adapters MUST NOT decide routing.** The agent proposes `proposed_next_role`; the orchestrator decides.

4. **Subprocess success ≠ turn success.** For `local_cli`, exit code 0 only means the process finished — the turn is only successful when the staged result passes orchestrator validation.

5. **All adapters share the staging contract.** Regardless of how the turn was executed, the result appears at `.agentxchain/staging/<turn_id>/turn-result.json`. This makes the orchestrator adapter-agnostic after the dispatch phase.

6. **Audit artifacts are best-effort.** `API_REQUEST.json`, `stdout.log`, `provider-response.json` are written for operator visibility. Failure to write them does not fail the turn.

7. **Prompt rendering is orchestrator-owned.** The dispatch bundle (`writeDispatchBundle()`) renders prompts. Adapters consume the rendered bundle, not raw config.

8. **Preflight audit artifacts are adapter-authored.** When `api_proxy` preflight tokenization is enabled (v1.1+), the adapter writes two additional audit artifacts into `.agentxchain/dispatch/turns/<turn_id>/`:
   - `TOKEN_BUDGET.json` — token budget decision report (provider, counts, section-level compression log, send/no-send verdict)
   - `CONTEXT.effective.md` — the exact context markdown sent to the provider after any compression
   These are adapter-scoped, not orchestrator-owned. They do not replace or modify the orchestrator-authored `CONTEXT.md`. See `PREEMPTIVE_TOKENIZATION_SPEC.md` for the full contract.

---

## Error Cases

| Condition | Adapter Type | Behavior |
|-----------|-------------|----------|
| No active turn in state | All | Return `{ ok: false, error }` immediately |
| Runtime not found in config | All | Return `{ ok: false, error }` |
| API key env var not set | `api_proxy` | Return `{ ok: false, error }` naming the var |
| Unsupported provider | `api_proxy` | Return `{ ok: false, error }` listing supported providers |
| Subprocess spawn failure | `local_cli` | Return `{ ok: false, error }` |
| Subprocess exits without staged result | `local_cli` | Return `{ ok: false, error }` with exit code |
| Subprocess times out | `local_cli` | SIGTERM → 10s grace → SIGKILL, return `{ timedOut: true }` |
| API returns non-200 | `api_proxy` | Return `{ ok: false, error }` with status + body excerpt |
| API response doesn't contain valid JSON | `api_proxy` | Return `{ ok: false, error }` describing extraction failure |
| Staged result file has <3 bytes | `manual` | `waitForStagedResult` keeps polling (file not "ready") |
| Abort signal received | All | Graceful shutdown, return `{ aborted: true }` |
| Role write_authority mismatch (api_proxy + authoritative) | `api_proxy` | Return `{ ok: false, error }` — v1 restriction |

---

## Acceptance Tests

| # | Test | Pass Condition |
|---|------|---------------|
| AT-1 | Manual adapter prints operator instructions | Output includes prompt path and staging path |
| AT-2 | Manual adapter detects staged result | `waitForStagedResult` returns `{ found: true }` when file appears |
| AT-3 | Manual adapter times out | Returns `{ timedOut: true }` after configured timeout |
| AT-4 | Manual adapter respects abort signal | Returns `{ aborted: true }` immediately |
| AT-5 | Local CLI spawns subprocess with argv prompt | Subprocess receives the full prompt text as an argument |
| AT-6 | Local CLI spawns subprocess with stdin prompt | Subprocess receives prompt via stdin |
| AT-7 | Local CLI detects staged result after subprocess exit | Returns `{ ok: true }` when staging file exists |
| AT-8 | Local CLI reports missing staged result | Returns `{ ok: false }` with meaningful error |
| AT-9 | Local CLI sends SIGTERM on timeout | Process receives SIGTERM at deadline |
| AT-10 | Local CLI SIGKILL after grace period | Process receives SIGKILL 10s after SIGTERM |
| AT-11 | API proxy rejects authoritative roles | Returns error for non-review_only write authority |
| AT-12 | API proxy fails on missing API key | Error names the specific env var |
| AT-13 | API proxy extracts JSON from raw response | Parses direct JSON response correctly |
| AT-14 | API proxy extracts JSON from markdown fences | Handles ````json` wrapped responses |
| AT-15 | API proxy overwrites cost with provider telemetry | `cost.usd` computed from actual token counts |
| AT-16 | API proxy persists audit artifacts | `API_REQUEST.json` and `provider-response.json` written |
| AT-17 | Dispatch bundle contains ASSIGNMENT.json, PROMPT.md, CONTEXT.md | All three files present after `writeDispatchBundle()` |
| AT-18 | Dispatch bundle PROMPT.md includes retry context on attempt > 1 | Previous rejection reason, failed stage, and errors shown |
| AT-19 | Dispatch bundle respects custom prompt templates | Role-specific `.agentxchain/prompts/{role}.md` content injected |

---

## Open Questions

1. Should v1.1 support a `webhook` adapter type for async external agent integrations (e.g., GitHub Actions, external CI)?
2. Should `api_proxy` support `authoritative` roles in v2 via tool-use APIs (agent creates patches, orchestrator applies them)?
3. Should adapter cost rates be configurable per-project instead of hardcoded? (Current rates are accurate as of 2026-04-01 but will drift.)
