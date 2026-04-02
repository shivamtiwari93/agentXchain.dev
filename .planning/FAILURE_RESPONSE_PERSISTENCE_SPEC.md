# Failure-Path Response Persistence Spec

## Purpose

When `api_proxy` receives a valid JSON response from the provider but `extractTurnResult()` fails to find governed turn-result JSON inside it, the raw provider response must be persisted as a debugging artifact. Currently, `provider-response.json` is only written on the success path — extraction failures leave no raw evidence.

This was surfaced by the first live preflight smoke run (see `LIVE_API_PROXY_PREFLIGHT_REPORT.md`): the provider consumed tokens on three attempts, but no raw response artifact was persisted because extraction failed every time.

## Interface

No new interfaces. The change is internal to `executeApiCall()` and the retry loop in `dispatchApiProxy()`.

## Behavior

### Current (broken)

1. `executeApiCall()` parses the JSON response, calls `extractTurnResult()`, and on extraction failure returns `{ ok: false, classified, usage }` — **without** the parsed `responseData`.
2. The retry loop's failure exit calls `errorReturn()` which writes `api-error.json` but has no access to `responseData`, so `provider-response.json` is never written.
3. `provider-response.json` is only written on the success path (after the retry loop, lines 713-724).

### Fixed

1. `executeApiCall()` returns `responseData` on extraction failure too: `{ ok: false, classified, usage, responseData }`.
2. In the retry loop, on failure exit (`!shouldRetryAttempt`), if `execution.responseData` exists, persist it to `provider-response.json` before returning. This uses the same best-effort write pattern as the success path.
3. On successful extraction, behavior is unchanged — `provider-response.json` is written on the success path as before.
4. Overflow local short-circuit: no `responseData` exists, no artifact written. Unchanged.
5. Non-JSON parse failure, timeout, network failure, auth failure: no `responseData` exists, no artifact written. Unchanged.

### Secret safety

`responseData` is the parsed JSON body from the provider API response. It does not contain the API key (that's in the request header, not the response). The response body contains model output, usage telemetry, and metadata — all appropriate for audit persistence.

## Artifact Path

`.agentxchain/staging/provider-response.json` — same path as the success-path artifact.

### Overwrite semantics

Best-effort write, same as the success path. If a prior `provider-response.json` exists from a previous run/turn, it is overwritten. This is consistent with the existing staging directory contract (staging is cleared or overwritten per turn).

## Error Cases

- `responseData` is too large to serialize: the `try/catch` around `writeFileSync` handles this (best-effort, silent failure). Same as the success path.
- `responseData` is `undefined` (timeout, network, auth failures): the conditional check prevents writing. No artifact created.

## Acceptance Tests

1. **Extraction failure persists raw response:** Mock provider returns valid JSON with no governed turn result. After retry exhaustion, `provider-response.json` exists in staging with the raw response body.
2. **Successful extraction unchanged:** Mock provider returns valid governed JSON. `provider-response.json` exists. Behavior identical to current.
3. **Non-JSON parse failure:** No `responseData` available. `provider-response.json` is NOT written. Only `api-error.json` exists.
4. **Local preflight overflow:** No provider call. `provider-response.json` is NOT written. Only `api-error.json` exists.
5. **HTTP error (4xx/5xx):** Response read as text, not parsed JSON. `provider-response.json` is NOT written.

## Open Questions

None. This is a narrow auditability fix.
