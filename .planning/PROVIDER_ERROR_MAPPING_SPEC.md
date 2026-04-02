# Provider-Specific Error Code Mapping Spec

> Post-v1.1 additive contract for mapping provider-native error response bodies to typed AgentXchain error classes beyond the current HTTP-status heuristic.

---

## Purpose

The current `classifyHttpError()` in `api-proxy-adapter.js` classifies errors using only HTTP status codes and a simple keyword scan of the response body. This works for the five-class split that v1 needs (auth, rate-limit, model-not-found, context-overflow, unknown), but it has known precision gaps:

1. **400 ambiguity**: Anthropic returns HTTP 400 for both context overflow *and* invalid request parameters. The current classifier uses a body-text keyword heuristic (`/context|token/i`), which will false-positive on an invalid `temperature` error message that happens to mention "token".
2. **429 sub-types**: Anthropic distinguishes daily spend limits (non-retryable) from per-minute rate limits (retryable) using `error.type`, but the current classifier treats all 429s as retryable `rate_limited`.
3. **Overloaded (529)**: Anthropic returns HTTP 529 for `overloaded_error`, which is retryable but currently falls through to `unknown_api_error`.
4. **Future providers**: When OpenAI or other providers are added, their error shapes differ substantially from Anthropic's. A single `classifyHttpError()` with provider-agnostic heuristics will not scale.

This spec defines a provider-keyed error mapping system that resolves these gaps while remaining backward compatible with the existing error classification contract.

---

## Interface/Schema

### Provider Error Map Type

```ts
type ProviderErrorType = string; // e.g. "overloaded_error", "invalid_request_error"

type ProviderErrorMapping = {
  /** Provider-native error type string (from response body) */
  provider_error_type: ProviderErrorType;

  /** Optional HTTP status constraint. When set, mapping only applies if both type AND status match. */
  http_status?: number | number[];

  /** Optional body keyword regex. When set, mapping only applies if body matches. */
  body_pattern?: string;

  /** AgentXchain error class to map to */
  error_class: ApiProxyErrorClass;

  /** Override the default retryable flag for this error class */
  retryable?: boolean;

  /** Override the default recovery message */
  recovery?: string;
};

type ProviderErrorMapRegistry = {
  [provider: string]: {
    /** How to extract the error type from the response body */
    extract_error_type: (body: unknown) => string | null;

    /** Ordered mappings — first match wins */
    mappings: ProviderErrorMapping[];
  };
};
```

### New Error Classes

This spec adds two new error classes to the existing closed enum:

```ts
type ApiProxyErrorClass =
  // existing v1 classes
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
  | 'unknown_api_error'
  // new in v1.2
  | 'invalid_request'
  | 'provider_overloaded';
```

`invalid_request` — The provider rejected the request for a structural/parameter reason that is NOT context overflow. Non-retryable. Operator must fix the config or prompt.

`provider_overloaded` — The provider is temporarily unable to handle the request due to load. Retryable with backoff.

### Updated Retryable Classes

```ts
const RETRYABLE_ERROR_CLASSES = [
  'rate_limited',
  'network_failure',
  'timeout',
  'response_parse_failure',
  'turn_result_extraction_failure',
  'unknown_api_error',
  'provider_overloaded', // new
];
```

### Classified Error Shape Extension

```ts
interface ApiProxyError {
  error_class: ApiProxyErrorClass;
  message: string;
  recovery: string;
  retryable: boolean;
  http_status: number | null;
  raw_detail: string | null;
  // new fields
  provider_error_type: string | null;   // native error type from provider body
  provider_error_code: string | null;   // provider-specific sub-code if present
}
```

New fields default to `null` when the provider response does not contain structured error information. Existing consumers that destructure only the v1 fields are unaffected.

---

## Behavior

### 1. Classification Priority

The classification pipeline becomes a three-stage waterfall:

```
Stage 1: Pre-request checks (missing_credentials, unsupported_provider)
         → unchanged from v1

Stage 2: Network/timeout classification
         → unchanged from v1 (catch block around fetch)

Stage 3: HTTP response classification
         → NEW: provider-specific mapping FIRST, then HTTP-status fallback
```

Within Stage 3, the new flow is:

```
3a. Parse response body as JSON (if possible)
3b. Extract provider_error_type using the provider's registered extractor
3c. Walk the provider's mapping list in order — first match wins
3d. If no provider mapping matched, fall through to the existing HTTP-status heuristic
3e. If the HTTP-status heuristic doesn't match either, return unknown_api_error
```

This means the existing HTTP-status heuristic becomes the fallback, not the primary classifier. Provider mappings override it when available.

### 2. Anthropic Error Map

Anthropic error responses have a consistent shape:

```json
{
  "type": "error",
  "error": {
    "type": "overloaded_error",
    "message": "Overloaded"
  }
}
```

Extractor: `(body) => body?.error?.type ?? null`

Mappings (ordered):

| # | `provider_error_type` | `http_status` | `body_pattern` | → `error_class` | `retryable` | Notes |
|---|---|---|---|---|---|---|
| 1 | `authentication_error` | 401 | — | `auth_failure` | false | |
| 2 | `permission_error` | 403 | — | `auth_failure` | false | |
| 3 | `not_found_error` | 404 | — | `model_not_found` | false | |
| 4 | `overloaded_error` | 529 | — | `provider_overloaded` | true | Currently falls to `unknown_api_error` |
| 5 | `rate_limit_error` | 429 | `daily\|spend\|budget` | `rate_limited` | **false** | Daily/spend limits are non-retryable |
| 6 | `rate_limit_error` | 429 | — | `rate_limited` | true | Per-minute rate limits are retryable |
| 7 | `invalid_request_error` | 400 | `context\|token.*limit\|too.many.tokens` | `context_overflow` | false | Preserves existing behavior |
| 8 | `invalid_request_error` | 400 | — | `invalid_request` | false | NEW: non-context 400s no longer misclassify |
| 9 | `api_error` | 500 | — | `unknown_api_error` | true | Anthropic internal error |

### 3. Retry Policy Interaction

- `provider_overloaded` is added to `RETRYABLE_ERROR_CLASSES` and to the default `retry_on` list.
- `rate_limited` with `retryable: false` (daily spend limit) is NOT retried even though the class name is in `retry_on`, because the per-mapping override sets `retryable = false` on the classified error, and `shouldRetryAttempt()` checks `classified.retryable` first.
- `invalid_request` is NOT added to `RETRYABLE_ERROR_CLASSES`. It is a config/prompt error.

### 4. Config Validation Extension

`VALID_API_PROXY_RETRY_CLASSES` gains `'provider_overloaded'` as a valid `retry_on` value. `'invalid_request'` is NOT valid in `retry_on` because it is never retryable.

### 5. Audit Artifact Extension

`api-error.json` gains the two new fields (`provider_error_type`, `provider_error_code`). `api-retry-trace.json` attempt records gain an optional `provider_error_type` field for richer per-attempt diagnostics.

### 6. Backward Compatibility

- Existing configs with no knowledge of the new error classes continue to work. The new classes only appear in error output, not in config input (except `provider_overloaded` in `retry_on`).
- Existing `classifyHttpError()` remains as the fallback path. It is not removed, just deprioritized after provider-specific mapping.
- The two new fields on `ApiProxyError` default to `null`, so existing destructuring is safe.

---

## Error Cases

- Provider returns non-JSON error body: fall through to HTTP-status heuristic (no provider mapping possible).
- Provider returns JSON without the expected `error.type` structure: extractor returns `null`, fall through to HTTP-status heuristic.
- Provider adds a new `error.type` not in the mapping table: no mapping match, fall through to HTTP-status heuristic.
- `body_pattern` regex is invalid at registration time: fail closed at module load, not at request time. All patterns are static literals.
- Multiple mappings could match: first-match-wins. Mapping order is intentional and tested.

---

## Acceptance Tests

1. **Anthropic 529 `overloaded_error` → `provider_overloaded`**: Mock fetch returns 529 with Anthropic error body `{ type: "error", error: { type: "overloaded_error" } }`. Assert: `error_class === 'provider_overloaded'`, `retryable === true`, `provider_error_type === 'overloaded_error'`.

2. **Anthropic 429 daily spend limit → non-retryable `rate_limited`**: Mock returns 429 with body containing `"daily spend limit"`. Assert: `error_class === 'rate_limited'`, `retryable === false`.

3. **Anthropic 429 per-minute rate limit → retryable `rate_limited`**: Mock returns 429 with body `"rate limit exceeded"` (no daily/spend keyword). Assert: `error_class === 'rate_limited'`, `retryable === true`.

4. **Anthropic 400 non-context `invalid_request_error` → `invalid_request`**: Mock returns 400 with `{ error: { type: "invalid_request_error", message: "temperature must be between 0 and 1" } }`. Assert: `error_class === 'invalid_request'`, `retryable === false`, NOT `context_overflow`.

5. **Anthropic 400 context overflow → `context_overflow`**: Mock returns 400 with `{ error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 token limit" } }`. Assert: `error_class === 'context_overflow'`.

6. **Non-JSON error body falls through to HTTP heuristic**: Mock returns 503 with HTML body. Assert: falls through to existing HTTP classifier, returns `unknown_api_error`.

7. **Unknown `error.type` falls through to HTTP heuristic**: Mock returns 400 with `{ error: { type: "new_future_error" } }`. Assert: falls through to HTTP status classifier.

8. **`provider_overloaded` is retried by default policy**: Config has `retry_policy.enabled = true`. Mock returns 529 overloaded, then 529, then 200 success. Assert: 3 attempts made, final success.

9. **Daily spend `rate_limited` is NOT retried**: Config has `retry_policy.enabled = true, retry_on: ["rate_limited"]`. Mock returns 429 with daily spend body. Assert: 1 attempt only, `retryable === false` overrides the class-level retry_on inclusion.

10. **`invalid_request` is rejected in `retry_on` config validation**: Config has `retry_on: ["invalid_request"]`. Assert: `validateV4Config()` fails.

11. **`provider_overloaded` is accepted in `retry_on` config validation**: Config has `retry_on: ["provider_overloaded"]`. Assert: validation passes.

12. **`provider_error_type` and `provider_error_code` appear in `api-error.json`**: After any Anthropic error with structured body, assert the artifact contains both new fields.

13. **New fields are `null` when body is unstructured**: After a network error or non-JSON response, assert `provider_error_type === null` and `provider_error_code === null`.

14. **First-match-wins ordering**: Mock returns 429 with body containing both "rate limit" and "daily". Assert: mapping #5 (daily → non-retryable) matches before mapping #6 (generic → retryable).

---

## Open Questions

1. Should the provider error map be configurable in `agentxchain.json`, or is it a hardcoded registry in the adapter? **Recommendation: hardcoded for v1.2.** The map is a correctness concern, not a user preference. Users should not be able to accidentally mark `auth_failure` as retryable.

2. Should `provider_overloaded` use a longer base backoff than `rate_limited`? Anthropic 529s often indicate sustained load, not momentary spikes. **Recommendation: defer to v1.3.** The existing backoff policy is sufficient and operators can tune `base_delay_ms` if needed.

3. When OpenAI support is added, should the OpenAI error map live in the same file or a separate provider module? **Recommendation: separate file per provider**, loaded by the registry at adapter init. This keeps each map testable in isolation.
