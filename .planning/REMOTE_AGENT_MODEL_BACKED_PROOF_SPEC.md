# Remote Agent Model-Backed Proof Spec

> Spec for proving that a real AI model (Claude) can satisfy the governed turn-result contract when fronted by the `remote_agent` HTTP bridge.

## Purpose

The existing `remote_agent` proof surface uses a hardcoded mock server that returns pre-built turn-result JSON. This is necessary but insufficient: it proves the adapter plumbing works, not that a real model can produce protocol-compliant output.

This spec defines a **model-backed bridge server** that:
1. Receives the governed turn envelope from `agentxchain step`
2. Forwards the prompt + context to the Anthropic Messages API (Claude)
3. Instructs the model to produce a valid turn-result JSON response
4. Returns the model's output as the HTTP response

If the model produces valid output that the acceptance pipeline accepts, this is the first real-model-backed connector proof. If it fails, the failure mode is documented precisely.

## Scope

### In Scope
- Bridge server that calls Claude (claude-haiku-4-5-20251001 for cost efficiency) via the Anthropic Messages API
- System prompt that teaches the model the exact turn-result schema contract
- Proof script that exercises `agentxchain step --role dev` (proposed) and `agentxchain step --role qa` (review_only) through the model-backed bridge
- Verification that the acceptance pipeline accepts the model's output with no content repair. The only allowed concession is removing outer markdown fences if the model wraps otherwise-valid JSON.
- Honest recording of whether it passes or fails, and what the failure modes are

### Out of Scope
- Retry/repair loops that fix model output before staging (that would be dishonest proof)
- Field-level post-processing, schema repair, or semantic correction of model output
- Multi-turn conversation with the model (single request/response per turn)
- Any model other than Claude (Anthropic API only for v1)
- Cost optimization beyond using Haiku
- Async polling or streaming

## Architecture

```
agentxchain step --role dev
  → remote_agent adapter POSTs turn envelope to bridge
    → bridge constructs Claude API request with:
        - system prompt: turn-result schema contract
        - user message: turn envelope (run_id, turn_id, role, phase, prompt, context)
    → Claude returns structured JSON
  → bridge returns model output as HTTP response
  → adapter stages at .agentxchain/staging/<turn_id>/turn-result.json
  → acceptance pipeline validates
```

## Bridge Server Contract

### Endpoint: `POST /turn`

1. Parse incoming turn envelope
2. Build Anthropic Messages API request:
   - `model`: `claude-haiku-4-5-20251001`
   - `max_tokens`: 4096
   - `system`: Schema contract prompt (exact required fields, types, patterns, constraints)
   - `messages`: Single user message with the turn envelope
3. Call `https://api.anthropic.com/v1/messages`
4. Extract the text content from the response
5. Parse as JSON
6. If the model wraps the JSON in outer markdown fences, strip only those delimiters and log the concession
7. Return the parsed JSON without field-level modification

### Endpoint: `GET /health`

Returns `{ status: "ok", model: "claude-haiku-4-5-20251001" }`.

### Environment Variables

- `ANTHROPIC_API_KEY` (required): API key for Claude
- `BRIDGE_PORT` (optional): port to listen on (default: random)

## System Prompt Design

The system prompt must teach the model exactly what the turn-result contract requires:

1. **Schema version**: must be `"1.0"`
2. **Identity fields**: `run_id`, `turn_id`, `role`, `runtime_id` — echo from envelope
3. **Status**: must be `"completed"`
4. **Decisions**: array with `id` matching `DEC-NNN` pattern (e.g., `DEC-001`), plus `category`, `statement`, `rationale`
5. **Objections**: for `review_only` roles, MUST include at least one objection with `id` matching `OBJ-NNN`, `severity` in `[low, medium, high, blocking]`, `status` in `[raised, acknowledged, resolved, escalated]`
6. **Proposed changes**: for `proposed` write authority, MUST include non-empty `proposed_changes[]` with `path`, `action` (`create`/`modify`/`delete`), and `content` (for create/modify)
7. **Verification**: `{ status: "pass", commands: [...], evidence_summary: "...", machine_evidence: [...] }`
8. **Artifact**: `{ type: "patch" }` for proposed, `{ type: "review" }` for review_only
9. **Routing**: `proposed_next_role` must be a valid role or `"human"`
10. **Response format**: request raw JSON only, no markdown fences, no explanatory text. Fence-free output remains the preferred transport shape, but the acceptance boundary is broader: one outer markdown-fence pair may be stripped if the enclosed JSON is otherwise valid.

## Proof Script

The proof script (`run-model-proof.mjs`) will:

1. Check `ANTHROPIC_API_KEY` is set
2. Start the model-backed bridge on a random port
3. Scaffold a governed project with `remote_agent` runtimes pointing to the bridge
4. Run `agentxchain step --role dev` → model generates proposed changes
5. Verify proposal materialization (PROPOSAL.md, SOURCE_SNAPSHOT.json)
6. Run `agentxchain proposal apply <turn_id>`
7. Run `agentxchain step --role qa` → model generates review with objection
8. Verify review artifact derivation
9. Print results: PASS with model details, or FAIL with exact failure point and model output

## Acceptance Tests

1. **P1**: Model-generated dev turn result passes the 5-stage validator without fixups
2. **P2**: Model-generated dev turn includes valid `proposed_changes[]` that materialize
3. **P3**: Model-generated QA turn result includes at least one objection (challenge requirement)
4. **P4**: Model-generated QA review derives a review artifact
5. **P5**: No field-level post-processing or fixup of model output between Claude response and staging; only one outer markdown-fence pair may be removed, and that concession must be logged
6. **F1**: If the model fails to produce valid JSON, the bridge returns an error and the proof documents the failure mode
7. **F2**: If the model produces JSON that fails validation, the proof documents which validator stage rejects it

## What This Proves

If all acceptance tests pass:
- A real AI model can produce governed turn results that satisfy the full acceptance pipeline
- The `remote_agent` adapter is not just plumbing — it can front real model intelligence
- The turn-result contract is teachable to a model via a single system prompt
- Fence-free raw JSON remains a best-effort request, not the release-critical invariant; the actual invariant is no field-level repair beyond logged outer-fence stripping

If it fails:
- Which part of the contract the model cannot reliably satisfy
- Whether the failure is in schema compliance, decision formatting, or protocol semantics
- Whether the system prompt needs refinement or the contract needs simplification

## What This Does NOT Prove

- That the model produces *useful* code (the proposed changes are protocol-compliant, not necessarily good)
- That this works reliably at scale (single proof run, not statistical)
- That other models (OpenAI, etc.) can satisfy the contract
- That the model can handle complex multi-file changes
- That the model will honor the fence-free transport preference on every call

## Cost Estimate

- Haiku input: ~2000 tokens per turn × 2 turns = ~4000 tokens → ~$0.004
- Haiku output: ~1000 tokens per turn × 2 turns = ~2000 tokens → ~$0.010
- Total: ~$0.014 per proof run
