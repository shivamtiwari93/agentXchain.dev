# Live Multi-Provider Governed Proof — Spec

## Purpose

Prove that AgentXchain can drive one governed run across two different `api_proxy` providers in sequence, with real governed state transitions and human approval gates:

1. `pm` review runs on OpenAI
2. planning gate pauses for approval
3. `qa` review runs on Anthropic
4. completion gate pauses for approval
5. the run completes cleanly

This is deliberately narrower than "multi-provider code writing." The current `api_proxy` adapter is still `review_only`, so this proof validates governed orchestration across providers and does not prove provider-authored repo writes.

## Interface

### Script

```bash
node examples/live-governed-proof/run-multi-provider-proof.mjs [--json] [--openai-base-url <url>] [--anthropic-base-url <url>]
```

- `--json` emits machine-readable output
- `--openai-base-url` overrides the OpenAI Chat Completions endpoint for test harnesses
- `--anthropic-base-url` overrides the Anthropic Messages endpoint for test harnesses

### Environment Gate

The script requires both provider credentials:

| Provider | Required Env Var |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |

If either credential is missing, the script exits `0` with `result: "skip"` and reports the missing variables. Missing credentials are not test failures.

## Behavior

1. Scaffold a temp governed project with two review-only roles:
   - `pm` → `api_proxy` / OpenAI / `gpt-4o-mini`
   - `qa` → `api_proxy` / Anthropic / `claude-haiku-4-5-20251001`
2. Seed truthful gate files under `.planning/` because `api_proxy` cannot write them directly.
3. Initialize the run with `initRun(root, config)`.
4. Assign `pm`, write the dispatch bundle, dispatch through OpenAI, validate pre-acceptance artifacts, and accept the turn.
5. Confirm the run pauses with `pending_phase_transition` for `planning_signoff`.
6. Approve the phase gate with `approvePhaseGate(root, config)`.
7. Assign `qa`, write the dispatch bundle, dispatch through Anthropic, validate pre-acceptance artifacts, and accept the turn.
8. Confirm the run pauses with `pending_run_completion` for `qa_ship_verdict`.
9. Approve the completion gate with `approveCompletionGate(root, config)`.
10. Validate final governed artifacts:
    - `state.json` shows `status: "completed"`
    - both phase gates are `passed`
    - `history.jsonl` contains exactly the `pm` then `qa` turn sequence
    - `decision-ledger.jsonl` exists and is non-empty
11. Print a structured result with per-provider usage, turn ids, artifact summaries, and final state.

## Error Cases

- Missing either credential → skip, not fail
- Provider call fails for either role → fail with classified adapter error
- Provider returns invalid governed JSON after retry budget is exhausted → fail
- PM turn does not request `phase_transition_request: "qa"` → fail
- QA turn does not request `run_completion_request: true` → fail
- Gate pause / approval sequence does not match protocol → fail
- Final state is not `completed` after approval → fail

## Acceptance Tests

1. Without either API key, the script exits `0` and reports `result: "skip"` plus the missing env vars.
2. With mocked OpenAI and Anthropic endpoints plus dummy credentials, the script exits `0`, both providers receive exactly one request, and the run completes.
3. The PM turn validates `PROMPT.md`, `CONTEXT.md`, `ASSIGNMENT.json`, `API_REQUEST.json`, `provider-response.json`, and `turn-result.json` before acceptance.
4. The QA turn validates the same artifacts before acceptance.
5. The OpenAI PM turn requests `phase_transition_request: "qa"`.
6. The Anthropic QA turn requests `run_completion_request: true`.
7. After both approvals, `state.json.status === "completed"` and both `planning_signoff` and `qa_ship_verdict` are `passed`.

## Boundary Rules

- Import only from `runner-interface.js` and `api-proxy-adapter.js`
- Do not import `governed-state.js`, `dispatch-bundle.js`, or `turn-paths.js` directly
- Do not shell out to the CLI binary
- Use cheap models to minimize proof cost
- Do not claim this proves authoritative multi-provider repo writes; it proves governed multi-provider review orchestration only

## Open Questions

None. The scope is intentionally narrow and matches the current adapter contract.
