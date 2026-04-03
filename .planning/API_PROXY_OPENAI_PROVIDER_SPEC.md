# API Proxy OpenAI Provider Spec

## Purpose

Add `openai` as a supported `api_proxy` provider for synchronous, `review_only` turns so AgentXchain can dispatch governed review work to OpenAI models without inventing a new adapter type.

This is a connector-expansion slice inside the existing `api_proxy` contract, not a broader adapter redesign.

## Interface

### Runtime config

```json
{
  "type": "api_proxy",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "auth_env": "OPENAI_API_KEY",
  "max_output_tokens": 4096,
  "timeout_seconds": 120,
  "retry_policy": {
    "enabled": true
  }
}
```

### Request contract

- Endpoint: `https://api.openai.com/v1/chat/completions`
- Auth: `Authorization: Bearer <OPENAI_API_KEY>`
- Request shape:
  - `model`
  - `messages`
    - developer message = `SYSTEM_PROMPT`
    - user message = `PROMPT.md + SEPARATOR + CONTEXT.md`
  - `response_format: { "type": "json_object" }`
  - `max_completion_tokens`

### Response contract

- The adapter extracts staged turn result JSON from `choices[0].message.content`
- `usage.prompt_tokens` maps to `cost.input_tokens`
- `usage.completion_tokens` maps to `cost.output_tokens`
- `usd` remains `0` unless the model exists in `COST_RATES`

## Behavior

### Included now

- `openai` accepted as a valid `api_proxy` provider
- OpenAI dispatch uses the existing synchronous review-only lifecycle
- Existing retry policy and error classification pipeline remains in force
- Provider-specific response extraction supports OpenAI chat completions
- Docs reflect OpenAI support truthfully

### Explicit non-goals

- No tool use
- No repo writes
- No `authoritative` or `proposed` roles on `api_proxy`
- No OpenAI Responses API integration in this slice
- No OpenAI-specific local tokenizer support

### Preflight tokenization boundary

`preflight_tokenization.tokenizer = "provider_local"` remains Anthropic-only in this slice.

If an `openai` runtime enables `preflight_tokenization`, config validation must fail early instead of allowing a runtime crash or silently switching tokenizers.

## Error Cases

- Missing `OPENAI_API_KEY` -> `missing_credentials`
- HTTP `401` / `403` -> `auth_failure`
- HTTP `404` -> `model_not_found`
- HTTP `429` -> `rate_limited`
- HTTP `400` with context/token limit text -> `context_overflow`
- HTTP `400` other -> `invalid_request`
- HTTP `500` / `502` / unclassified -> `unknown_api_error`
- Malformed JSON response -> `response_parse_failure`
- JSON response without extractable turn result -> `turn_result_extraction_failure`
- `openai` + enabled `preflight_tokenization` -> config validation error

## Acceptance Tests

1. `validateV4Config()` accepts `provider: "openai"` for `api_proxy`.
2. `validateV4Config()` rejects enabled `preflight_tokenization` on `provider: "openai"`.
3. OpenAI request builder emits `messages`, `response_format.type = "json_object"`, and `max_completion_tokens`.
4. OpenAI dispatch sends `Authorization: Bearer ...` and stages a valid turn result from `choices[0].message.content`.
5. OpenAI usage telemetry is mapped from `prompt_tokens` and `completion_tokens`.
6. OpenAI `401` classifies as `auth_failure`.
7. OpenAI `429` classifies as `rate_limited`.
8. OpenAI `400` with token/context limit text classifies as `context_overflow`.
9. Adapter docs list both Anthropic and OpenAI as supported providers.
10. Adapter docs state that `provider_local` preflight tokenization is currently Anthropic-only.

## Open Questions

- Whether a future slice should switch OpenAI support from Chat Completions to the Responses API once the adapter needs richer structured output or background execution.
- Whether `COST_RATES` should grow an OpenAI model catalog or remain token-only for providers without a pinned price table in repo.
