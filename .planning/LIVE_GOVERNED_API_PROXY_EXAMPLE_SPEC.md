# Live Governed API Proxy Example — Spec

## Purpose

Prove that AgentXchain can govern a real AI agent turn end-to-end: scaffold a governed project, assign a review-only turn, dispatch it to a real LLM API via the `api_proxy` adapter, accept the structured result, and validate all governed artifacts (state.json, history.jsonl, decision-ledger.jsonl, dispatch audit, staging).

This is the first proof that AgentXchain governs **real model output**, not mock data.

## Interface

### Script

```
examples/live-governed-proof/run-live-turn.mjs [--json] [--provider anthropic|openai]
```

- `--json` — machine-readable output
- `--provider` — select provider (default: `anthropic`)

### Environment Gate

The script requires exactly one credential env var depending on the provider:

| Provider | Required Env Var |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |

If the required env var is not set, the script exits with code 0 and a skip message (not failure). This ensures CI stays deterministic — live proof runs only when credentials are explicitly available.

### Exit Codes

- `0` — proof passed, or skipped (no credentials)
- `1` — proof failed (API error, validation error, artifact mismatch)

## Behavior

1. **Gate check.** If the required API key env var is missing, print skip reason and exit 0.
2. **Scaffold.** Create a temp directory with `agentxchain.json`, `.agentxchain/state.json`, `history.jsonl`, `decision-ledger.jsonl`, and a minimal QA role prompt.
3. **Init run.** Call `initRun(root, config)` via runner-interface.js.
4. **Assign turn.** Call `assignTurn(root, config, 'qa')` — QA is `review_only` + `api_proxy`.
5. **Write dispatch bundle.** Call `writeDispatchBundle(root, state, config)`.
6. **Dispatch.** Call `dispatchApiProxy(root, state, config)` — this sends a real API request to the configured provider.
7. **Validate pre-acceptance artifacts.** Assert dispatch and staging artifacts exist BEFORE acceptance (acceptTurn cleans up both dirs after commit):
   - Dispatch audit: `PROMPT.md`, `CONTEXT.md`, `ASSIGNMENT.json`, `API_REQUEST.json` exist under `.agentxchain/dispatch/turns/{turn_id}/`
   - Staging: `turn-result.json` exists under `.agentxchain/staging/{turn_id}/`
   - Turn result: `schema_version`, `run_id`, `turn_id`, `role`, `status`, `decisions` fields present
8. **Accept turn.** Call `acceptTurn(root, config)` — validates and accepts the staged result.
9. **Validate post-acceptance artifacts.** Assert governed ledger artifacts exist:
   - `state.json`: has `run_id`, `status`, `schema_version`
   - `history.jsonl`: ≥1 entry with `turn_id` and `role`
   - `decision-ledger.jsonl`: ≥1 entry
   - Dispatch audit: `PROMPT.md`, `CONTEXT.md`, `ASSIGNMENT.json`, `API_REQUEST.json` exist under `.agentxchain/dispatch/turns/{turn_id}/`
   - Staging: `turn-result.json` exists under `.agentxchain/staging/{turn_id}/`
   - Turn result: `schema_version`, `run_id`, `turn_id`, `role`, `status`, `decisions` fields present
9. **Report.** Print structured proof result (pass/fail, artifacts, usage, cost).
10. **Cleanup.** Remove temp directory.

## Error Cases

- Missing credentials → skip (exit 0), not fail
- API returns non-200 → report classified error and fail (exit 1)
- Model returns response that fails turn-result extraction → report and fail
- Any governed artifact missing or malformed after acceptance → fail
- `dispatchApiProxy` returns `{ ok: false }` → report classified error and fail

## Acceptance Tests

1. With `ANTHROPIC_API_KEY` set: script exits 0, JSON output contains `result: "pass"`, `provider: "anthropic"`, `usage.input_tokens > 0`, `usage.output_tokens > 0`, and all artifact validations pass.
2. Without any API key: script exits 0, JSON output contains `result: "skip"`.
3. Dispatch audit artifacts (`API_REQUEST.json`, `PROMPT.md`, `CONTEXT.md`, `ASSIGNMENT.json`) exist and are parseable after a successful run.
4. Turn result staged by the real model contains `schema_version`, `run_id`, `turn_id`, `role`, `decisions` (the model follows the governed prompt contract).

## Boundary Rules

- Imports ONLY from `runner-interface.js` and `api-proxy-adapter.js` (the declared interfaces).
- Does NOT import `governed-state.js`, `turn-paths.js`, `dispatch-bundle.js`, or any other internal module directly.
- Does NOT shell out to the CLI binary.
- Uses `claude-haiku-4-5-20251001` (cheapest model) to minimize cost during proof runs.

## Open Questions

None. This spec is intentionally narrow: one turn, one role, one provider call, one acceptance, full artifact validation.
