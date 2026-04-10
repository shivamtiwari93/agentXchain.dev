# Adapter Docs Contract Spec

**Status:** Proposed
**Scope:** `/docs/adapters` deep-dive page truthfulness against shipped runtime code
**Files under audit:**
- `website-v2/docs/adapters.mdx` (docs)
- `cli/src/lib/adapters/local-cli-adapter.js` (local_cli)
- `cli/src/lib/adapters/api-proxy-adapter.js` (api_proxy)
- `cli/src/lib/adapters/manual-adapter.js` (manual)
- `cli/src/lib/normalized-config.js` (config validation)
- `cli/src/lib/turn-result-validator.js` (schema enforcement)

---

## Purpose

Assert that the public adapter deep-dive page documents the shipped adapter runtime behavior truthfully. Every behavioral claim, configuration example, error classification, and protocol constraint must be verifiable against implementation code.

---

## Defects Found

### D1 — Prompt transport mode names are wrong (CRITICAL)

**Docs claim:** `stdin`, `file`, `arg`
**Code truth:** `argv`, `stdin`, `dispatch_bundle_only`

Two of three mode names in the docs are fabricated. An operator configuring `"prompt_transport": "file"` or `"prompt_transport": "arg"` would get a validation error or silent fallback.

Source: `local-cli-adapter.js:303-314`, `normalized-config.js:19`

### D2 — SIGTERM grace period is wrong

**Docs claim:** "waits 5 seconds, then SIGKILL"
**Code truth:** Grace period is 10 seconds (`setTimeout(..., 10000)`)

Source: `local-cli-adapter.js:171-176`

### D3 — Retry policy tables are fabricated

**Docs claim:** Per-HTTP-status retry schedules (429 → "1s, 2s, 4s, 8s, 16s max 5 retries", 500 → "2s, 4s, 8s max 3 retries")
**Code truth:** One configurable retry policy object with defaults: `max_attempts: 3`, `base_delay_ms: 1000`, `max_delay_ms: 8000`, `backoff_multiplier: 2`, `jitter: 'full'`. Retry eligibility is per error_class, not per HTTP status.

Source: `api-proxy-adapter.js:66-71`

### D4 — Error classification categories are fabricated

**Docs claim:** 3 categories: `transient`, `permanent`, `parse`
**Code truth:** 9+ named error classes: `auth_failure`, `model_not_found`, `provider_overloaded`, `rate_limited`, `context_overflow`, `invalid_request`, `network_failure`, `timeout`, `response_parse_failure`, `turn_result_extraction_failure`, `unknown_api_error`

Source: `api-proxy-adapter.js:55-63`

### D5 — Supported provider and endpoint-override surface drifted

**Current code truth:** `PROVIDER_ENDPOINTS` includes `anthropic` and `openai`. The runtime may also include an optional `base_url` endpoint override, but only within those supported provider families. `provider` still determines request formatting, auth headers, and error classification. Arbitrary custom providers are not supported.

Source: `api-proxy-adapter.js:44-47`, `api-proxy-adapter.js:765`, `normalized-config.js`

### D6 — Custom adapter interface is fabricated

**Docs claim:** TypeScript `Adapter` interface with `dispatch()`, `wait()`, `collect()` methods. Registration via `adapters` config key.
**Code truth:** No `Adapter` type is exported. Adapters are plain function modules. No `adapters` registration key exists in config validation.

### D7 — api_proxy config example shows wrong fields

**Docs claim:** Flat `max_retries: 5` field in adapter_config
**Code truth:** Retry is configured via nested `retry_policy` object with `enabled`, `max_attempts`, `base_delay_ms`, `max_delay_ms`, `backoff_multiplier`, `jitter`, `retry_on` fields.

Source: `normalized-config.js:31-39`, `api-proxy-adapter.js:66-71`

### D8 — Objections claim is overly broad

**Docs claim:** "The objections array must contain at least one entry — blind agreement is a protocol violation."
**Code truth:** Only `review_only` roles must have at least one objection (when `challenge_required !== false`). Other roles can have an empty objections array.

Source: `turn-result-validator.js:438-446`

### D9 — api_proxy review_only restriction not documented

**Code truth:** v1 api_proxy is restricted to `review_only` roles only. Non-review_only roles bound to api_proxy runtimes fail config validation.

Source: `normalized-config.js:277-282`

### D10 — Preflight tokenization not documented

**Code truth:** api_proxy supports preflight token budgeting with `preflight_tokenization` config: `enabled`, `tokenizer`, `safety_margin_tokens`, `context_window_tokens`.

Source: `api-proxy-adapter.js:463-475`, `normalized-config.js:41-45`

### D11 — Comparison table prompt transport values wrong

Same as D1 but in the comparison table row. Says "stdin, file, or arg" for local_cli.

### D12 — local_cli default timeout not documented

**Code truth:** When no `deadline_at` is set on the turn, local_cli falls back to 1,200,000 ms (20 minutes) — same as manual adapter.

Source: `local-cli-adapter.js:89-91`

### D13 — Nested-literal regex extraction is a false proof surface

**Current test weakness:** `docs-adapters-content.test.js` scrapes object literals like `PROVIDER_ENDPOINTS`, `BUNDLED_COST_RATES`, and `DEFAULT_RETRY_POLICY` using lazy regex over source text.

**Why this is weak:** Nested braces inside URLs or nested object values can truncate the match while still letting both sides of an assertion drift together. That is accidental green, not contract proof.

**Required truth source:** Import live exports for adapter constants whenever possible. Use source-text regex only for flat declarations where nested structure cannot silently truncate the match.

---

## Acceptance Tests

1. Prompt transport modes in docs match `VALID_PROMPT_TRANSPORTS` in `normalized-config.js`
2. SIGTERM grace period in docs matches the timeout constant in `local-cli-adapter.js`
3. Error class names in docs match `RETRYABLE_ERROR_CLASSES` and non-retryable classes in `api-proxy-adapter.js`
4. Retry policy defaults in docs match `DEFAULT_RETRY_POLICY` in `api-proxy-adapter.js`
5. Provider list in docs matches keys of `PROVIDER_ENDPOINTS` in `api-proxy-adapter.js`
6. No fabricated custom adapter registration interface in docs
7. api_proxy config examples use the real nested `retry_policy` shape
8. Objections requirement is scoped to `review_only` roles
9. api_proxy `review_only` restriction is documented
10. Preflight tokenization is documented
11. Comparison table prompt transport values match implementation
12. `base_url` is documented as an optional endpoint override for supported providers only
13. Docs do not claim `base_url` creates arbitrary custom provider support
14. `docs-adapters-content.test.js` imports live adapter constants for provider endpoints and bundled cost rates instead of scraping nested object literals with regex
15. Any remaining source extraction in `docs-adapters-content.test.js` is limited to flat declarations that cannot be truncated by nested braces

---

## Open Questions

None. All defects have clear code-backed truth sources.
