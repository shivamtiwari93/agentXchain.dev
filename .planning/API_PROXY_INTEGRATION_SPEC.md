# API Proxy Integration Proof Spec

## Purpose

Prove that `agentxchain run` correctly dispatches `review_only` roles through the `api_proxy` adapter end-to-end, without weakening any production validation rules.

## Background

- `review_only + local_cli` is rejected by `normalized-config.js` (line 372–376)
- `api_proxy` only binds to `review_only` roles (Session #19 freeze, line 378–384)
- Previous `run` integration tests (`run-integration.test.js`) patched all roles to `authoritative + local_cli`, so the `review_only + api_proxy` path was never exercised

## Approach

1. **`base_url` runtime field**: The api_proxy adapter now supports an optional `base_url` field on the runtime config. When present, it overrides the hardcoded `PROVIDER_ENDPOINTS[provider]`. This is a legitimate product feature (custom endpoints, Azure OpenAI, self-hosted models) and also enables clean integration testing.

2. **Mock HTTP server**: Tests spin up a local HTTP server (Node `createServer`) that mimics the Anthropic Messages API response format. The mock extracts `run_id`, `turn_id`, `role`, and `runtime_id` from the dispatch prompt to build schema-valid turn results.

3. **Mixed adapter fixture**: The test config uses `local_cli` (authoritative) for pm/dev and `api_proxy` (review_only) for qa — exactly the production-valid configuration. No validation bypasses.

4. **Async spawn**: Tests use `spawn` (not `spawnSync`) because the mock HTTP server runs in the test process event loop.

## Interface

### `base_url` runtime field

```json
{
  "type": "api_proxy",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "auth_env": "ANTHROPIC_API_KEY",
  "base_url": "https://custom-endpoint.example.com/v1/messages"
}
```

When `base_url` is set, the adapter uses it directly instead of `PROVIDER_ENDPOINTS[provider]`. The `provider` field is still required for request formatting and error classification.

## Acceptance Tests

| ID | Description | Pass criteria |
|----|-------------|---------------|
| AT-RUN-APIPROXY-INT-001 | Full lifecycle with mixed local_cli + api_proxy | Run completes (exit 0), mock server receives >= 1 request with proper auth headers, state shows completed/gate_held |
| AT-RUN-APIPROXY-INT-002 | Correct Anthropic request format | Request body has model, messages array, max_tokens; user message present |
| AT-RUN-APIPROXY-INT-003 | Missing credentials → graceful failure | Process exits cleanly, no requests reach server, output mentions missing credential |

## Decisions

- `DEC-APIPROXY-BASE-URL-001`: `base_url` is a runtime-level override, not a global config. It respects provider request formatting and error classification.
- `DEC-APIPROXY-INT-001`: No `test_mode` or schema relaxation. The integration test uses production-valid configuration only.
- `DEC-APIPROXY-INT-002`: Mock server extracts real IDs from dispatch prompt to build schema-valid turn results that pass all validation stages.
- `DEC-APIPROXY-INT-003`: Mock turn result includes at least one objection because `review_only` roles must challenge (protocol requirement).
