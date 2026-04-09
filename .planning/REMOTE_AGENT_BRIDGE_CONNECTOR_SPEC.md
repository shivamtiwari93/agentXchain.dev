# Remote Agent Bridge Connector Spec

## Purpose

Prove connector replaceability beyond local subprocess dispatch by adding a governed remote agent bridge that executes turns over HTTP against an external agent service.

This is a Layer 3 connector slice from `VISION.md`, not an IDE-distribution stunt. The protocol only earns "replaceable connectors" credibility when a non-local runtime can execute the same governed turn contract without bypassing staging, validation, or acceptance.

## Interface

### Runtime Config

```json
{
  "type": "remote_agent",
  "url": "https://agent.example.com/agentxchain/turn",
  "headers": {
    "authorization": "Bearer replace-with-real-token"
  },
  "timeout_ms": 120000
}
```

### Field Contract

- `type`: must be `"remote_agent"`
- `url`: required absolute `http:` or `https:` URL
- `headers`: optional string-to-string request headers
- `timeout_ms`: optional positive integer; default bounded timeout

### Request Contract

The connector POSTs a governed turn envelope containing:

- run, turn, role, and phase identifiers
- rendered `PROMPT.md` and `CONTEXT.md`
- absolute artifact paths for dispatch/staging context
- runtime metadata needed for audit and traceability

### Response Contract

The remote service must return a valid AgentXchain turn-result payload in one synchronous response body. The connector stages that payload at the normal `.agentxchain/staging/<turn_id>/turn-result.json` path.

## Behavior

1. Reuse the existing dispatch bundle and turn-result validation flow.
2. Treat the remote connector as synchronous in v1: dispatch, receive, stage, validate, accept.
3. Restrict v1 write authority to `review_only` and `proposed`. Do not allow `authoritative` until a real workspace-mutation bridge exists.
4. For `review_only`, derive a review artifact under `.agentxchain/reviews/` on acceptance.
5. For `proposed`, require `proposed_changes` and materialize the accepted proposal under `.agentxchain/proposed/<turn_id>/`.
6. Fail closed on non-2xx responses, malformed JSON, missing turn-result fields, or timeout.
7. Persist enough transport metadata for operator evidence without leaking secret header values.
8. Document this as a connector bridge for governed remote execution, not as a generic hosted orchestration surface.
9. Document implementor failure traps explicitly: `decisions[].id` must match `DEC-NNN`, and `review_only` roles must return at least one objection.
10. Do not imply environment-variable interpolation inside `headers`; values are sent exactly as configured.

## Error Cases

- Missing or invalid `url`
- Non-string header values
- Remote timeout or network failure
- Non-2xx response from remote service
- Response body is not valid JSON
- Response body is JSON but not a valid turn result
- `authoritative` role bound to `remote_agent`
- Secret headers echoed into logs or artifacts
- Remote service uses free-form or dynamic decision IDs instead of `DEC-NNN`
- Remote service returns a `review_only` result without objections
- Docs imply header interpolation that the runtime does not implement

## Acceptance Tests

1. Config validation accepts valid `remote_agent` runtimes and rejects invalid URLs or headers.
2. Dispatch posts the governed turn envelope to a local HTTP test server and stages the returned turn result.
3. `authoritative` roles are rejected for `remote_agent`; `review_only` and `proposed` are accepted.
4. Accepted `review_only` turns derive a review artifact; accepted `proposed` turns derive a proposal artifact.
5. A subprocess E2E proves `agentxchain step` can dispatch to a local remote-agent bridge, accept the turn, and materialize the proposal artifact for `proposal apply`.
6. Timeout and non-2xx paths fail clearly.
7. Logs and artifacts record remote target metadata without leaking authorization headers.
8. Adapter docs describe the remote connector truthfully and distinguish it from MCP transport.
9. A subprocess E2E rejects remote responses whose `decisions[].id` do not match `DEC-NNN`.
10. A subprocess E2E rejects `review_only` remote responses that omit objections.
11. Docs/examples state that header values are literal config strings; operators must pre-expand any secrets before writing config.

## Out Of Scope

- Environment-variable interpolation inside `headers` is not implemented in v1. Operators must pre-expand values before writing `agentxchain.json`.
- Async polling and webhook completion are not part of the v1 connector contract. `remote_agent` remains synchronous: POST, wait, stage.
