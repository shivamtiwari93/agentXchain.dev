# Integration Guide Factual Accuracy Spec

## Purpose

Ensure every integration guide in `website-v2/docs/integrations/` accurately describes the authentication mechanism, endpoint contract, and proxy requirements of its target provider. A guide must never imply a direct connection works when a proxy or translation layer is required.

## Scope

All 22 integration guides under `website-v2/docs/integrations/`.

## Factual Accuracy Invariants

### FA-1: Auth mechanism must match adapter behavior

If the `api_proxy` adapter sends `Authorization: Bearer <key>`, the guide must not claim the provider accepts that header unless the provider genuinely does. If SigV4, OAuth, or another mechanism is required, the guide must state this and show the proxy/translation path.

### FA-2: No fake API key env vars

If the provider does not accept simple API keys (e.g., Bedrock requires SigV4), the guide must not show `auth_env: "PROVIDER_API_KEY"` as if exporting that key is sufficient. It must show the proxy auth path.

### FA-3: Proxy requirement must be explicit

If a provider requires a proxy (SigV4 translation, OAuth token exchange, etc.), the guide must:
- State the proxy requirement prominently (not just in gotchas)
- Show proxy setup steps
- Show the proxy URL as the `base_url`

### FA-4: Illustrative URLs must be labeled

If a guide shows a URL that is not the real endpoint (e.g., Devin's `https://api.devin.ai/v1/turn`), the guide must explicitly say the URL is illustrative.

### FA-5: All guides must have a governed bootstrap example

Every guide must include a "Minimal working example" section showing `init --governed ... --dir <dir> -y` → `cd <dir>` → `connector check` → `doctor` → `run`, plus a mention of the guided interactive path.

### FA-6: Cost-rate examples must describe override truth

If a guide shows `budget.cost_rates` for a model that is not in AgentXchain's bundled defaults, the guide must say that:
- the snippet is an operator-supplied override, not part of a complete built-in pricing catalog
- the `cost_rates` key must match the exact runtime `model` string
- bundled defaults are intentionally narrow, so non-bundled models require explicit operator rates

## Provider-Specific Accuracy Notes

### Amazon Bedrock
- Auth: AWS IAM / SigV4 only — no API key auth
- Requires a proxy (LiteLLM, Bedrock Access Gateway, or equivalent)
- `base_url` must point to the proxy, not to `bedrock-runtime.*.amazonaws.com`

### All other `api_proxy` providers
- Anthropic: `x-api-key` header (adapter handles this natively)
- OpenAI, DeepSeek, Mistral, xAI, Groq, Cohere, Qwen (DashScope): Bearer token via OpenAI-compatible API (adapter handles this natively)
- Google: API key as query param (adapter handles this natively)
- Ollama, MLX: local endpoints, optional auth (adapter handles this natively)

### Devin (`remote_agent`)
- URL is illustrative — Devin's actual API surface must be checked by the operator

### MCP
- No external auth — stdio subprocess or operator-controlled HTTP endpoint

## Acceptance Tests

See `cli/test/integration-guide-factual-accuracy.test.js`.
