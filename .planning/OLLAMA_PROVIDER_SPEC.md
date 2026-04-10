# Ollama Provider Spec — Local Model Support for api_proxy

## Purpose

Add `ollama` as a first-class `api_proxy` provider, enabling governed agent turns
against local models (Llama, Mistral, Gemma, Phi, etc.) without API keys.

This advances the vision's "self-hostable and local-first execution paths" and
"interoperable across models and tools" by proving that governed workflows run
identically regardless of whether the model is cloud-hosted or local.

## Interface

### Config

```json
{
  "runtimes": {
    "local_dev": {
      "type": "api_proxy",
      "provider": "ollama",
      "model": "llama3.2",
      "base_url": "http://localhost:11434/v1/chat/completions"
    }
  }
}
```

- `provider: "ollama"` is accepted by config validation
- `auth_env` is **optional** for `ollama` (no API key needed by default)
- `base_url` defaults to `http://localhost:11434/v1/chat/completions` when omitted
- All other `api_proxy` config fields remain unchanged (model, max_output_tokens, timeout_seconds, retry)

### Request Format

Ollama uses OpenAI-compatible request format. `buildProviderRequest('ollama', ...)` delegates to `buildOpenAiRequest(...)`.

### Auth

- When `auth_env` is absent or empty: no `Authorization` header sent
- When `auth_env` is set: standard Bearer token header (same as OpenAI)
- This supports both:
  - Bare Ollama (`ollama serve`) — no auth
  - Ollama behind a proxy or auth layer — operator-supplied auth

### Error Mapping

Ollama error responses use OpenAI-compatible error structure. `PROVIDER_ERROR_MAPS.ollama` mirrors the OpenAI error map.

### Cost Rates

No bundled cost rates for `ollama`. Local compute cost is operator-specific. Operators can supply rates via `budget.cost_rates` if they want cost tracking.

## Behavior

1. Config validation accepts `provider: "ollama"` for `api_proxy` runtimes
2. Config validation does NOT require `auth_env` when provider is `ollama`
3. Config validation injects default `base_url` when provider is `ollama` and `base_url` is omitted
4. Adapter skips auth header when no `auth_env` is configured (or env var is unset)
5. Request format is OpenAI-compatible (messages array, model, max_tokens)
6. Response extraction uses the same OpenAI text extraction path
7. Error classification uses OpenAI-compatible error structure
8. Connector health check reports `ollama` as a recognized provider

## Error Cases

- Ollama not running: `network_failure` (connection refused)
- Model not pulled: Ollama returns 404 → `model_not_found`
- Context overflow: Ollama returns 400 with context message → `context_overflow`
- Invalid response JSON: `response_parse_failure` (existing path)

## Acceptance Tests

- AT-OLLAMA-001: `VALID_API_PROXY_PROVIDERS` includes `"ollama"`
- AT-OLLAMA-002: Config with `provider: "ollama"` and no `auth_env` validates without error
- AT-OLLAMA-003: Config with `provider: "ollama"` and explicit `auth_env` validates without error
- AT-OLLAMA-004: `buildProviderRequest('ollama', ...)` produces OpenAI-compatible request body
- AT-OLLAMA-005: Default endpoint for `ollama` is `http://localhost:11434/v1/chat/completions`
- AT-OLLAMA-006: No `Authorization` header when `auth_env` is absent
- AT-OLLAMA-007: `Authorization: Bearer <key>` header when `auth_env` is set and env var populated
- AT-OLLAMA-008: `PROVIDER_ERROR_MAPS.ollama` exists and mirrors OpenAI structure
- AT-OLLAMA-009: Existing anthropic/openai/google providers still require `auth_env`
- AT-OLLAMA-010: Ollama cost rates are not bundled (returns null from `getCostRates`)
- AT-OLLAMA-011: Docs (adapters page) mention ollama as supported provider
- AT-OLLAMA-012: `llms.txt` updated if needed

## Open Questions

- Live proof against a real Ollama instance is not possible in this environment.
  The proof boundary is unit tests + config validation + request/response format verification.
  Real Ollama proof should happen when an operator runs the governed workflow against a local model.
