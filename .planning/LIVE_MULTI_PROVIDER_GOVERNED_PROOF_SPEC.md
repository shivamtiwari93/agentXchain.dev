# Live Multi-Provider Governed Proof — Spec

## Purpose

Prove that AgentXchain can drive one governed run across three different `api_proxy` providers in sequence, with real governed state transitions and human approval gates:

1. `pm` review runs on OpenAI
2. planning gate pauses for approval
3. `architect` review runs on Google Gemini
4. implementation gate pauses for approval
5. `qa` review runs on Anthropic
6. completion gate pauses for approval
7. the run completes cleanly

This is deliberately narrower than "multi-provider code writing." The current `api_proxy` adapter is still `review_only`, so this proof validates governed orchestration across providers and does not prove provider-authored repo writes.

## Interface

### Script

```bash
node examples/live-governed-proof/run-multi-provider-proof.mjs [--json] [--openai-base-url <url>] [--google-base-url <url>] [--anthropic-base-url <url>]
```

- `--json` emits machine-readable output
- `--openai-base-url` overrides the OpenAI Chat Completions endpoint for test harnesses
- `--google-base-url` overrides the Google Gemini generateContent endpoint for test harnesses
- `--anthropic-base-url` overrides the Anthropic Messages endpoint for test harnesses

### Environment Gate

The script requires all three provider credentials:

| Provider | Required Env Var |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Google | `GOOGLE_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |

If any credential is missing, the script exits `0` with `result: "skip"` and reports the missing variables. Missing credentials are not test failures.

## Behavior

1. Scaffold a temp governed project with three review-only roles:
   - `pm` → `api_proxy` / OpenAI / `gpt-4o-mini`
   - `architect` → `api_proxy` / Google / `gemini-2.0-flash`
   - `qa` → `api_proxy` / Anthropic / `claude-haiku-4-5-20251001`
2. Seed truthful gate files under `.planning/` because `api_proxy` cannot write them directly.
   - Planning gate: `PM_SIGNOFF.md`, `ROADMAP.md`, `SYSTEM_SPEC.md`
   - Implementation gate: `IMPLEMENTATION_NOTES.md` (with `## Changes` and `## Verification`), `ARCHITECTURE_REVIEW.md`
   - QA gate: `acceptance-matrix.md`, `ship-verdict.md`, `RELEASE_NOTES.md`
3. Initialize the run with `initRun(root, config)`.
4. Assign `pm`, write the dispatch bundle, dispatch through OpenAI, validate pre-acceptance artifacts, and accept the turn.
5. Confirm the run pauses with `pending_phase_transition` for `planning_signoff` (transition to `implementation`).
6. Approve the planning phase gate with `approvePhaseGate(root, config)`.
7. Assign `architect`, write the dispatch bundle, dispatch through Google Gemini, validate pre-acceptance artifacts, and accept the turn.
8. Confirm the run pauses with `pending_phase_transition` for `implementation_signoff` (transition to `qa`).
9. Approve the implementation phase gate with `approvePhaseGate(root, config)`.
10. Assign `qa`, write the dispatch bundle, dispatch through Anthropic, validate pre-acceptance artifacts, and accept the turn.
11. Confirm the run pauses with `pending_run_completion` for `qa_ship_verdict`.
12. Approve the completion gate with `approveCompletionGate(root, config)`.
13. Validate final governed artifacts:
    - `state.json` shows `status: "completed"`
    - all three phase gates are `passed` (`planning_signoff`, `implementation_signoff`, `qa_ship_verdict`)
    - `history.jsonl` contains exactly the `pm` then `architect` then `qa` turn sequence
    - `decision-ledger.jsonl` exists and has at least 3 entries
14. Print a structured result with per-provider usage, turn ids, artifact summaries, and final state.

## Error Cases

- Missing any credential → skip, not fail
- Provider call fails for any role → fail with classified adapter error
- Provider returns invalid governed JSON after retry budget is exhausted → fail
- PM turn does not request `phase_transition_request: "implementation"` → fail
- Architect turn does not request `phase_transition_request: "qa"` → fail
- QA turn does not request `run_completion_request: true` → fail
- Gate pause / approval sequence does not match protocol → fail
- Final state is not `completed` after approval → fail

## Acceptance Tests

1. Without any API key, the script exits `0` and reports `result: "skip"` plus the missing env vars.
2. With mocked OpenAI, Google, and Anthropic endpoints plus dummy credentials, the script exits `0`, all three providers receive exactly one request, and the run completes.
3. The PM turn validates `PROMPT.md`, `CONTEXT.md`, `ASSIGNMENT.json`, `API_REQUEST.json`, `provider-response.json`, and `turn-result.json` before acceptance.
4. The Architect turn validates the same artifacts before acceptance.
5. The QA turn validates the same artifacts before acceptance.
6. The OpenAI PM turn requests `phase_transition_request: "implementation"`.
7. The Google Architect turn requests `phase_transition_request: "qa"`.
8. The Anthropic QA turn requests `run_completion_request: true`.
9. After all three approvals, `state.json.status === "completed"` and all three gates are `passed`.

## Boundary Rules

- Import only from `runner-interface.js` and `api-proxy-adapter.js`
- Do not import `governed-state.js`, `dispatch-bundle.js`, or `turn-paths.js` directly
- Do not shell out to the CLI binary
- Use cheap models to minimize proof cost
- Do not claim this proves authoritative multi-provider repo writes; it proves governed multi-provider review orchestration only

## Open Questions

None. The scope is intentionally narrow and matches the current adapter contract.
