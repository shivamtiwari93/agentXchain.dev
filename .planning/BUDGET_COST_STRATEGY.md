# Budget & Cost Surface Strategy — DEC-COST-STRATEGY-001

## Problem Statement

The human identified four concerns with the current model-cost / budget surface:

1. **OpenAI cost tables may be outdated.** Verified: OpenAI prices matched training knowledge but could not be live-verified (Cloudflare blocks automated access to openai.com/pricing).
2. **Codex-family models are missing.** `codex-mini-latest` ($1.50/$6.00 per MTok as of May 2025) is not in the rate table.
3. **Many providers are missing.** Anthropic and OpenAI are covered. DeepSeek, Qwen, Kimi, Mistral, Google Gemini, and local inference are not.
4. **Strategic risk: maintaining a complete public pricing catalog is a permanent catch-up game.**

Additionally, verification revealed that **Anthropic prices were already wrong**:
- `claude-opus-4-6` was hardcoded at $15/$75 — actual price is $5/$25 (Opus 4.6 is cheaper than Opus 4.1)
- `claude-haiku-4-5-20251001` was hardcoded at $0.80/$4.00 — actual is $1.00/$5.00 (the $0.80/$4.00 rate is Haiku 3.5)

## Decision: Operator-Supplied Cost Rates with Bundled Defaults

### The Model

AgentXchain should **not** try to maintain a complete per-model/per-provider public pricing catalog. Instead:

1. **Bundled defaults**: Keep a small, curated set of well-known model rates as convenience defaults. These are clearly labeled as "bundled defaults that may be outdated." Updated when verified against official sources.

2. **Operator-supplied `cost_rates`**: Add a `cost_rates` field to `agentxchain.json` where operators can supply their own per-model rates. These override bundled defaults.

3. **Unknown models get `usd: 0`**: If a model is not in bundled defaults and the operator hasn't supplied rates, cost tracking returns 0. Budget enforcement still works (it's token-based), but USD cost is unknown.

4. **No first-party truth claim**: The bundled rates are a convenience, not a product truth. The docs explicitly state that operators should verify rates against their provider's pricing page.

### Why This Is Right

- **Truthful**: We don't claim to know every model's price. We provide useful defaults and let operators correct them.
- **Sustainable**: New providers/models enter the system by operator configuration, not by us chasing every pricing page.
- **Pragmatic**: The most common models (Claude, GPT-4o, o3/o4) have bundled rates for out-of-box usefulness.
- **Extensible**: Local inference (Ollama, vLLM) can declare $0 rates. Custom provider pricing can be exact.

### Scope Boundary

- **In scope**: Anthropic Claude family, OpenAI GPT-4o/4.1/o3/o4 family, and the narrow Gemini starter set we now ship (`gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`).
- **Out of scope for bundled defaults**: DeepSeek, Qwen, Kimi, Mistral, broader Gemini catalog, Cohere, etc. These enter via operator config.
- **Update strategy**: Bundled rates updated when we verify against official sources. A `// Verified: YYYY-MM-DD` comment marks each rate.

### Config Shape

```json
{
  "budget": {
    "per_turn_max_usd": 2.0,
    "per_run_max_usd": 50.0,
    "on_exceed": "pause_and_escalate",
    "cost_rates": {
      "deepseek-v3": { "input_per_1m": 0.27, "output_per_1m": 1.10 },
      "claude-opus-4-6": { "input_per_1m": 5.00, "output_per_1m": 25.00 }
    }
  }
}
```

Operator `cost_rates` override bundled defaults for any matching model key.

## Corrected Bundled Rates (Verified 2026-04-07)

### Anthropic (verified via docs.anthropic.com)
- `claude-opus-4-6`: $5.00 / $25.00
- `claude-sonnet-4-6`: $3.00 / $15.00
- `claude-haiku-4-5-20251001`: $1.00 / $5.00

### OpenAI (from training knowledge, could not live-verify)
- `gpt-4o`: $2.50 / $10.00
- `gpt-4o-mini`: $0.15 / $0.60
- `gpt-4.1`: $2.00 / $8.00
- `gpt-4.1-mini`: $0.40 / $1.60
- `gpt-4.1-nano`: $0.10 / $0.40
- `o3`: $2.00 / $8.00
- `o3-mini`: $1.10 / $4.40
- `o4-mini`: $1.10 / $4.40

### Google Gemini (training knowledge, added after the original decision because AgentXchain now ships a Google connector)
- `gemini-2.5-pro`: $1.25 / $10.00
- `gemini-2.5-flash`: $0.15 / $0.60
- `gemini-2.0-flash`: $0.10 / $0.40
