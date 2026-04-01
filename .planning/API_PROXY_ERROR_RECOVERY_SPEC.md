# API Proxy Error Recovery Spec

> Standalone contract for `api_proxy` adapter error classification and operator recovery.

---

## Purpose

The `api_proxy` adapter makes synchronous HTTP calls to LLM providers. When those calls fail, the raw error (HTTP status, exception message) is not actionable for operators. This spec defines a closed set of typed error classes for v1, each with a deterministic recovery path that the CLI surfaces to the operator.

---

## Interface

### `ApiProxyError` — Classified Error Shape

```typescript
interface ApiProxyError {
  /** Closed enum — one of the v1 error classes */
  error_class:
    | 'missing_credentials'
    | 'auth_failure'
    | 'rate_limited'
    | 'model_not_found'
    | 'context_overflow'
    | 'network_failure'
    | 'timeout'
    | 'response_parse_failure'
    | 'turn_result_extraction_failure'
    | 'unsupported_provider'
    | 'unknown_api_error';

  /** Human-readable error message (what happened) */
  message: string;

  /** Operator-facing recovery instruction (what to do next) */
  recovery: string;

  /** Whether the operator can retry the same request without changes */
  retryable: boolean;

  /** HTTP status code if applicable, null otherwise */
  http_status: number | null;

  /** Raw upstream error detail (truncated to 500 chars) */
  raw_detail: string | null;
}
```

### `dispatchApiProxy` — Updated Return Shape

```typescript
// Error case:
{ ok: false, error: string, classified?: ApiProxyError }

// Success case (unchanged):
{ ok: true, staged: true, usage: object | null }
```

The `classified` field is present on all error returns from the adapter. The `error` string field is preserved for backward compatibility — it is always `classified.message`.

---

## Behavior

### Error Classification Table

| Error Class | Trigger | HTTP Status | Retryable | Recovery |
|---|---|---|---|---|
| `missing_credentials` | `process.env[auth_env]` is falsy | n/a | No | `Set environment variable "{auth_env}" and retry: agentxchain step --resume` |
| `auth_failure` | API returns 401 or 403 | 401, 403 | No | `Check that "{auth_env}" contains a valid API key for {provider}` |
| `rate_limited` | API returns 429 | 429 | Yes | `Rate limited by {provider}. Wait and retry: agentxchain step --resume` |
| `model_not_found` | API returns 404 | 404 | No | `Model "{model}" not found. Check runtime config model name.` |
| `context_overflow` | API returns 400 with "context" or "token" in error body | 400 | No | `Prompt exceeds model context window. Reduce context or switch to a larger model.` |
| `network_failure` | `fetch()` throws non-abort error | n/a | Yes | `Network error: {message}. Check connectivity and retry: agentxchain step --resume` |
| `timeout` | `AbortError` from timeout (not user SIGINT) | n/a | Yes | `Request timed out after {seconds}s. Increase timeout_seconds in runtime config or retry.` |
| `response_parse_failure` | `response.json()` throws | n/a | Yes | `Provider returned non-JSON response. This is usually transient. Retry: agentxchain step --resume` |
| `turn_result_extraction_failure` | `extractTurnResult()` returns `ok: false` | n/a | Yes | `Model responded but did not produce valid turn result JSON. Retry or complete manually.` |
| `unsupported_provider` | Provider not in `PROVIDER_ENDPOINTS` | n/a | No | `Provider "{provider}" is not supported. Supported: {list}` |
| `unknown_api_error` | HTTP error not matching above patterns | varies | Yes | `API returned {status}. Review error detail and retry or complete manually.` |

### Classification Logic

Classification is deterministic and runs in priority order:

1. Pre-request checks (missing_credentials, unsupported_provider) — before any HTTP call
2. Network/timeout — `catch` block around `fetch()`
3. HTTP status classification — `401/403 → auth_failure`, `429 → rate_limited`, `404 → model_not_found`, `400 + context/token keyword → context_overflow`, other → `unknown_api_error`
4. Response parse — `response.json()` failure
5. Turn result extraction — `extractTurnResult()` failure

### Audit Artifact

When an error is classified, the adapter writes the `ApiProxyError` object to `.agentxchain/staging/api-error.json` (best-effort). This provides structured evidence for post-mortem review alongside the existing `API_REQUEST.json`.

---

## Error Cases (for this spec itself)

- If classification logic encounters an unexpected error during classification, it falls back to `unknown_api_error` with the raw message.
- The `raw_detail` field is always truncated to 500 characters to prevent log explosion from large HTML error pages.

---

## Acceptance Tests

1. **Missing credentials → `missing_credentials`**: Config has `auth_env: "ANTHROPIC_API_KEY"`, env var is unset. Assert: `error_class === 'missing_credentials'`, `retryable === false`, recovery mentions the env var name.

2. **Unsupported provider → `unsupported_provider`**: Config has `provider: "openai"`. Assert: `error_class === 'unsupported_provider'`, `retryable === false`.

3. **401 response → `auth_failure`**: Mock fetch returns 401. Assert: `error_class === 'auth_failure'`, `http_status === 401`, `retryable === false`.

4. **403 response → `auth_failure`**: Mock fetch returns 403. Assert: `error_class === 'auth_failure'`, `http_status === 403`.

5. **429 response → `rate_limited`**: Mock fetch returns 429. Assert: `error_class === 'rate_limited'`, `retryable === true`.

6. **404 response → `model_not_found`**: Mock fetch returns 404. Assert: `error_class === 'model_not_found'`, `retryable === false`.

7. **400 with "context length" → `context_overflow`**: Mock fetch returns 400 with body containing "context length exceeded". Assert: `error_class === 'context_overflow'`, `retryable === false`.

8. **400 with "token" in body → `context_overflow`**: Mock fetch returns 400 with "maximum.*token" in body. Assert: `error_class === 'context_overflow'`.

9. **400 without context keyword → `unknown_api_error`**: Mock fetch returns 400 with body "Bad request: invalid parameter". Assert: `error_class === 'unknown_api_error'`.

10. **Network failure → `network_failure`**: Mock fetch throws `TypeError('fetch failed')`. Assert: `error_class === 'network_failure'`, `retryable === true`.

11. **Timeout → `timeout`**: Mock fetch throws `AbortError`. Assert: `error_class === 'timeout'`, `retryable === true`.

12. **Non-JSON response → `response_parse_failure`**: Mock fetch returns 200 with HTML body. Assert: `error_class === 'response_parse_failure'`, `retryable === true`.

13. **Model returns prose instead of JSON → `turn_result_extraction_failure`**: Mock fetch returns valid Anthropic JSON with text block containing no JSON. Assert: `error_class === 'turn_result_extraction_failure'`, `retryable === true`.

14. **Classified error written to `api-error.json`**: After any error, assert file exists at `.agentxchain/staging/api-error.json` with matching `error_class`.

15. **Success case → no `classified` field**: On successful dispatch, assert `result.classified` is undefined.

---

## Open Questions

1. Should `context_overflow` attempt to measure the prompt size before sending and warn preemptively? (Deferred — v2 concern, requires tokenizer.)
2. Should retry-able errors auto-retry within the adapter, or always return to the operator? (v1: always return to operator. Auto-retry is a v2 feature with backoff policy.)
