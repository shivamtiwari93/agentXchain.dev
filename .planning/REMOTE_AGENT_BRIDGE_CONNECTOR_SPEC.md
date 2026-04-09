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
    "authorization": "Bearer ${REMOTE_AGENT_TOKEN}"
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
3. Fail closed on non-2xx responses, malformed JSON, missing turn-result fields, or timeout.
4. Persist enough transport metadata for operator evidence without leaking secret header values.
5. Document this as a connector bridge for governed remote execution, not as a generic hosted orchestration surface.

## Error Cases

- Missing or invalid `url`
- Non-string header values
- Remote timeout or network failure
- Non-2xx response from remote service
- Response body is not valid JSON
- Response body is JSON but not a valid turn result
- Secret headers echoed into logs or artifacts

## Acceptance Tests

1. Config validation accepts valid `remote_agent` runtimes and rejects invalid URLs or headers.
2. Dispatch posts the governed turn envelope to a local HTTP test server and stages the returned turn result.
3. Timeout and non-2xx paths fail clearly.
4. Logs and artifacts record remote target metadata without leaking authorization headers.
5. Adapter docs describe the remote connector truthfully and distinguish it from MCP transport.

## Open Questions

- Whether v1 should support environment-variable header interpolation directly or require pre-expanded config values.
- Whether later slices should add async polling/webhook completion instead of synchronous request-response only.
