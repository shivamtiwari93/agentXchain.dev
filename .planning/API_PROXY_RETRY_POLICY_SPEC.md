# API Proxy Retry Policy Spec

> Post-v1 additive contract for automatic retries inside the `api_proxy` adapter. This spec preserves the governed turn model while reducing operator intervention on transient upstream failures.

---

## Purpose

Define the v1.1 retry behavior for `api_proxy` runtimes. The goal is narrow:

- automatically retry transient provider failures that are already classified as retryable
- keep retries adapter-local so the governed turn lifecycle does not change
- preserve auditability so operators can see every attempt, delay, and final outcome
- remain fully backward compatible with v1 configs that expect one request and immediate operator recovery on failure

This spec does **not** add background jobs, queueing, or automatic state mutation. Retries happen synchronously inside one `agentxchain step` dispatch.

---

## Interface/Schema

### Runtime Config Extension

`api_proxy` runtimes may add an optional `retry_policy` block:

```json
{
  "type": "api_proxy",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "auth_env": "ANTHROPIC_API_KEY",
  "max_output_tokens": 4096,
  "timeout_seconds": 120,
  "retry_policy": {
    "enabled": true,
    "max_attempts": 3,
    "base_delay_ms": 1000,
    "max_delay_ms": 8000,
    "backoff_multiplier": 2,
    "jitter": "full",
    "retry_on": ["rate_limited", "network_failure", "timeout"]
  }
}
```

### `retry_policy` Shape

```ts
type ApiProxyRetryPolicy = {
  enabled?: boolean;
  max_attempts?: number;
  base_delay_ms?: number;
  max_delay_ms?: number;
  backoff_multiplier?: number;
  jitter?: "none" | "full";
  retry_on?: ApiProxyRetryClass[];
};

type ApiProxyRetryClass =
  | "rate_limited"
  | "network_failure"
  | "timeout"
  | "response_parse_failure"
  | "turn_result_extraction_failure"
  | "unknown_api_error";
```

### Defaults

When `retry_policy.enabled !== true`, behavior is unchanged from v1: one request, no automatic retries.

When `retry_policy.enabled === true`, defaults are:

- `max_attempts = 3` (initial request plus up to 2 retries)
- `base_delay_ms = 1000`
- `max_delay_ms = 8000`
- `backoff_multiplier = 2`
- `jitter = "full"`
- `retry_on = all currently retryable classified errors`

### Adapter Return Shape Additions

`dispatchApiProxy()` remains backward compatible and may add:

```ts
type ApiProxyDispatchResult =
  | {
      ok: true;
      staged: true;
      usage: object | null;
      attempts_made?: number;
      retry_trace_path?: string;
    }
  | {
      ok: false;
      error: string;
      classified?: ApiProxyError;
      attempts_made?: number;
      retry_trace_path?: string;
    };
```

### Audit Artifact

The adapter writes a best-effort trace file at:

```text
.agentxchain/staging/api-retry-trace.json
```

```ts
type ApiProxyRetryTrace = {
  provider: string;
  model: string;
  run_id: string;
  turn_id: string;
  runtime_id: string;
  max_attempts: number;
  attempts_made: number;
  final_outcome: "success" | "failure" | "aborted";
  aggregate_usage: {
    input_tokens: number;
    output_tokens: number;
    usd: number;
  };
  attempts: Array<{
    attempt: number;
    started_at: string;
    completed_at: string;
    outcome: "success" | ApiProxyRetryClass | "non_retryable_error";
    retryable: boolean;
    http_status: number | null;
    scheduled_delay_ms: number;
    actual_delay_ms: number;
    usage: {
      input_tokens: number;
      output_tokens: number;
      usd: number;
    } | null;
  }>;
};
```

---

## Behavior

### 1. Retry Scope

Automatic retry is adapter-local only.

- It does not increment `state.current_turn.attempt`
- It does not append history rows
- It does not change `state.status`
- It does not create new dispatch bundles

Governed retry via `reject-turn` remains the outer recovery mechanism for bad but well-formed turn results. This spec only covers transport/provider failures inside one dispatch.

### 2. Retry Decision

After each failed attempt, the adapter retries only when all are true:

1. `retry_policy.enabled === true`
2. the failure is classified
3. `classified.retryable === true`
4. `attempt_number < max_attempts`
5. `retry_on` is absent or includes `classified.error_class`
6. no external abort has been requested

If any condition fails, the adapter returns immediately with the classified error.

### 3. Non-Retryable Errors

These MUST never be retried automatically:

- `missing_credentials`
- `auth_failure`
- `model_not_found`
- `context_overflow`
- `unsupported_provider`

They are configuration/operator errors, not transient transport faults.

### 4. Delay Calculation

Before retry attempt `n` (`n >= 2`), compute:

```ts
raw_delay_ms = min(
  max_delay_ms,
  base_delay_ms * backoff_multiplier ** (n - 2)
);
```

Jitter rules:

- `jitter = "none"`: `actual_delay_ms = raw_delay_ms`
- `jitter = "full"`: `actual_delay_ms` is a random integer in `[0, raw_delay_ms]`

The sleep MUST be interruptible by `AbortSignal`. A user `SIGINT` aborts immediately; it does not wait for the backoff timer to finish.

### 5. Timeout Semantics

`timeout_seconds` stays per-attempt, not whole-dispatch. Total wall time therefore becomes:

```text
sum(each attempt timeout ceiling) + sum(backoff delays)
```

This is intentional. The operator opts into the longer ceiling by enabling `retry_policy`.

### 6. Cost and Usage Accounting

Retries may consume billable tokens, especially when the provider returns a syntactically valid response that later fails extraction. Therefore:

- the adapter MUST accumulate `usage` across all attempts that returned provider telemetry
- on final success, `turn-result.json -> cost` MUST contain the aggregate totals across all attempts, not only the last successful attempt
- on final failure, aggregate usage MUST still be written to `api-retry-trace.json`

This preserves governed budget accuracy on successful accepted turns without requiring adapter writes to `state.json`.

### 7. Artifact Rules

On each attempt:

- `API_REQUEST.json` remains the per-dispatch request summary and may include the active retry policy
- `provider-response.json` contains only the final successful provider response
- `api-error.json` contains only the final failure classification when the dispatch ends in failure
- `api-retry-trace.json` records every attempt, including intermediate failures and any usage data

If a later retry succeeds, stale `api-error.json` from earlier failures MUST be removed so staging reflects the final outcome cleanly.

### 8. CLI Surface

`agentxchain step` should remain concise but explicit:

- before each retry: print attempt number, error class, and scheduled delay
- on success after retry: print success with `attempts_made`
- on final failure: print final classified recovery plus the number of attempts exhausted

The existing operator recovery commands do not change.

### 9. Backward Compatibility

Existing configs with no `retry_policy` block remain valid and keep single-attempt behavior. This is a strict additive change.

---

## Error Cases

- Invalid retry config:
  `max_attempts < 1`, negative delays, `max_delay_ms < base_delay_ms`, unsupported jitter mode, or `retry_on` values outside the closed enum must fail config validation.

- Aborted during backoff:
  return failure immediately with final outcome `aborted`; do not schedule another attempt.

- Aborted during in-flight request:
  treat as `aborted`, not `timeout`, when the abort came from the external signal rather than the adapter's timeout controller.

- Trace write failure:
  best-effort only. Dispatch outcome is governed by the provider/result path, not by audit artifact persistence.

- Aggregate usage mismatch:
  if a provider response lacks usage telemetry, record zero usage for that attempt rather than failing dispatch.

---

## Acceptance Tests

1. Config with no `retry_policy` performs exactly one request and returns the first classified error unchanged.
2. Config with `retry_policy.enabled = true` and `max_attempts = 3` retries a `429 rate_limited` response twice, then succeeds on the third response without changing `state.current_turn.attempt`.
3. `auth_failure` never retries even when `retry_policy.enabled = true`.
4. `retry_on = ["rate_limited"]` retries `429` but does not retry `network_failure`.
5. `jitter = "none"` produces deterministic delays of `1000ms`, then `2000ms`, capped by `max_delay_ms`.
6. `jitter = "full"` draws a delay between `0` and the computed raw delay for each retry.
7. External abort during backoff stops immediately, returns `ok: false`, and records `final_outcome = "aborted"` in the trace.
8. External abort during fetch stops immediately and does not classify the result as retryable timeout.
9. Successful completion after two failed attempts writes `turn-result.json` and removes any stale `api-error.json`.
10. Final failure after exhausting retries writes `api-error.json` for the last failure and `api-retry-trace.json` with all attempts.
11. Two usage-bearing attempts followed by success aggregate token/cost totals into the staged turn result `cost` field.
12. Invalid config (`max_attempts = 0`, `jitter = "randomized"`, or unknown `retry_on` class) fails `validateV4Config()`.

---

## Open Questions

1. Should v1.1 add a whole-dispatch ceiling such as `max_elapsed_ms`, or is per-attempt timeout plus bounded backoff sufficient?
2. Should aggregate retry spend on a final failed dispatch be reflected in governed budget state immediately, or remain audit-only until a valid turn is accepted?
3. Should the adapter persist every raw failed provider response, or is the structured retry trace enough for v1.1?
