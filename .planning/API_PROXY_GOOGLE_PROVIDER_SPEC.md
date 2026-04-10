# API Proxy Google Provider Spec

## Purpose

Add `google` as a supported `api_proxy` provider so AgentXchain can dispatch governed `review_only` and `proposed` turns to Gemini models without inventing a separate adapter family.

This is a connector-expansion slice inside the existing `api_proxy` contract. It does not widen `api_proxy` write authority or change the governed lifecycle.

## Interface

### Runtime config

```json
{
  "type": "api_proxy",
  "provider": "google",
  "model": "gemini-2.5-flash",
  "auth_env": "GOOGLE_API_KEY",
  "max_output_tokens": 4096,
  "timeout_seconds": 120,
  "retry_policy": {
    "enabled": true
  }
}
```

### Request contract

- Endpoint template: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Auth: API key passed as `?key=<GOOGLE_API_KEY>` query parameter
- Headers:
  - `Content-Type: application/json`
- Request shape:
  - `systemInstruction.parts[0].text = SYSTEM_PROMPT`
  - `contents[0].role = "user"`
  - `contents[0].parts[0].text = PROMPT.md + SEPARATOR + CONTEXT.md`
  - `generationConfig.maxOutputTokens`
  - `generationConfig.responseMimeType = "application/json"`

### Response contract

- The adapter extracts staged turn result JSON from `candidates[0].content.parts[*].text`
- `usageMetadata.promptTokenCount` maps to `cost.input_tokens`
- `usageMetadata.candidatesTokenCount` maps to `cost.output_tokens`
- `promptFeedback.blockReason` and non-`STOP` `candidates[0].finishReason` must survive into the extraction-failure message so operators can distinguish blocked/truncated Gemini responses from generic JSON drift
- Bundled cost defaults may be used, but operator-supplied `budget.cost_rates` overrides remain authoritative

## Behavior

### Included now

- `google` accepted as a valid `api_proxy` provider in config validation
- Gemini dispatch uses the existing synchronous `api_proxy` lifecycle
- Provider-specific request formatting and response extraction support Gemini `generateContent`
- Provider-specific error mapping supports Google status codes and error statuses
- Docs reflect Google support truthfully

### Explicit non-goals

- No tool use
- No repo writes
- No `authoritative` roles on `api_proxy`
- No OpenAI-compatible fallback mode for Gemini
- No local provider tokenizer for Gemini in this slice

### Preflight tokenization boundary

`preflight_tokenization.tokenizer = "provider_local"` remains unsupported for `google` in this slice.

If a `google` runtime enables `preflight_tokenization`, config validation must fail early instead of allowing a runtime crash or silently switching tokenizers.

## Error Cases

- Missing `GOOGLE_API_KEY` -> `missing_credentials`
- HTTP `401` / `403` with `UNAUTHENTICATED` / `PERMISSION_DENIED` -> `auth_failure`
- HTTP `404` with `NOT_FOUND` -> `model_not_found`
- HTTP `429` with `RESOURCE_EXHAUSTED` -> `rate_limited`
- HTTP `400` with token/context limit text -> `context_overflow`
- HTTP `400` other `INVALID_ARGUMENT` -> `invalid_request`
- HTTP `503` with `UNAVAILABLE` -> `provider_overloaded`
- HTTP `500` with `INTERNAL` or unclassified -> `unknown_api_error`
- Malformed JSON response -> `response_parse_failure`
- Prompt blocked via `promptFeedback.blockReason` -> `turn_result_extraction_failure` with the Google block reason named in the message
- Candidate halted with non-`STOP` `finishReason` and no valid turn JSON -> `turn_result_extraction_failure` with the Gemini finish reason named in the message
- JSON response without extractable turn result -> `turn_result_extraction_failure`
- `google` + enabled `preflight_tokenization` -> config validation error

## Acceptance Tests

1. `validateV4Config()` accepts `provider: "google"` for `api_proxy`.
2. `validateV4Config()` rejects enabled `preflight_tokenization` on `provider: "google"`.
3. Gemini request builder emits `systemInstruction`, `contents`, `generationConfig.maxOutputTokens`, and `responseMimeType = "application/json"`.
4. Gemini dispatch interpolates `{model}` into the endpoint and sends the API key as a query parameter instead of a header.
5. Gemini dispatch stages a valid turn result from `candidates[0].content.parts[*].text`.
6. Gemini usage telemetry is mapped from `usageMetadata.promptTokenCount` and `usageMetadata.candidatesTokenCount`.
7. Google `UNAUTHENTICATED` classifies as `auth_failure`.
8. Google `RESOURCE_EXHAUSTED` classifies as `rate_limited`.
9. Google `INVALID_ARGUMENT` with token-limit text classifies as `context_overflow`.
10. Adapter docs list Anthropic, OpenAI, and Google as supported providers.
11. Adapter docs and config validation both preserve the boundary that `provider_local` preflight tokenization is not available for Google.
12. Gemini prompt blocks surface `promptFeedback.blockReason` in the extraction-failure message.
13. Gemini non-`STOP` finish reasons surface in the extraction-failure message when no valid turn JSON is extractable.

## Open Questions

- Whether a future slice should support Gemini multi-turn chat state instead of the current single request / single response governed turn.
- Whether bundled Gemini cost defaults should stay intentionally narrow or expand to a broader model catalog.
