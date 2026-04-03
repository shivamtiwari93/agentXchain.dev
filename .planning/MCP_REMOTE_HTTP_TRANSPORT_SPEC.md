# MCP Remote HTTP Transport Spec

## Purpose

Extend the existing governed `mcp` runtime so AgentXchain can dispatch turns to remote MCP servers over HTTP, not just local stdio subprocesses.

This is the next connector-layer slice from `VISION.md` Layer 3:

- keep the governed MCP tool contract
- expand transport reach from local stdio to remote MCP endpoints
- do not invent a second adapter type or a hosted control plane

## Scope

### In Scope

- Keep `type: "mcp"` as the single governed MCP runtime type
- Add transport selection inside that runtime
- Support `streamable_http` transport using the MCP SDK client transport
- Preserve the existing stdio path as the default
- Support static request headers for remote MCP endpoints
- Keep the same governed `tool_name` contract and staged-result lifecycle
- Add code-backed docs coverage and runtime tests

### Out Of Scope

- OAuth or interactive MCP auth flows
- Stateful session management requirements beyond what the SDK handles internally
- SSE transport in this slice
- Arbitrary MCP prompt/resource/task orchestration
- Streaming turn acceptance or background polling
- Claiming compatibility with every remote MCP server

## Interface

### Runtime Config

#### Local stdio (existing default)

```json
{
  "type": "mcp",
  "command": "node",
  "args": ["./examples/mcp-echo-agent/server.js"],
  "tool_name": "agentxchain_turn",
  "cwd": "."
}
```

#### Remote streamable HTTP

```json
{
  "type": "mcp",
  "transport": "streamable_http",
  "url": "http://127.0.0.1:8787/mcp",
  "tool_name": "agentxchain_turn",
  "headers": {
    "x-agentxchain-project": "demo"
  }
}
```

### Field Contract

- `type`: must be `"mcp"`
- `transport`: optional, defaults to `"stdio"`
- `tool_name`: optional, defaults to `agentxchain_turn`

#### `transport: "stdio"`

- `command`: required, non-empty string or non-empty string array
- `args`: optional string array when `command` is a string
- `cwd`: optional relative working directory
- `url`: rejected
- `headers`: rejected

#### `transport: "streamable_http"`

- `url`: required, valid absolute `http:` or `https:` URL
- `headers`: optional object of string-to-string request headers
- `command`: rejected
- `args`: rejected
- `cwd`: rejected

## Behavior

### Shared governed behavior

Both MCP transports must:

1. verify the dispatch manifest
2. resolve the target turn and runtime
3. read `PROMPT.md` and `CONTEXT.md`
4. run `tools/list`
5. require the configured tool name to exist
6. call the governed MCP tool with the standard AgentXchain turn argument object
7. extract the turn result from `structuredContent`, nested SDK wrapper content, or JSON text
8. stage the result at `.agentxchain/staging/<turn_id>/turn-result.json`

The orchestrator validation and acceptance path remains unchanged.

### Remote transport behavior

- The adapter connects using MCP `StreamableHTTPClientTransport`
- Static `headers` are attached to the SDK request init
- The transport remains synchronous in AgentXchain terms: dispatch, stage, validate, accept
- If the server returns `405` on `GET`, the client still proceeds via POST request flow; docs must not imply SSE is required

## Error Cases

- `transport` is unknown -> config validation error
- `streamable_http` without `url` -> config validation error
- `streamable_http` with invalid or non-HTTP URL -> config validation error
- `streamable_http` with non-string header values -> config validation error
- `stdio` runtime configured with remote-only fields -> config validation error
- `streamable_http` runtime configured with stdio-only fields -> config validation error
- remote MCP endpoint unreachable -> dispatch error
- remote MCP endpoint exposes no required governed tool -> dispatch error naming the tool
- remote MCP tool returns no extractable turn-result payload -> dispatch error

## Acceptance Tests

1. `validateV4Config()` accepts `transport: "streamable_http"` with a valid absolute HTTP URL.
2. `validateV4Config()` rejects `streamable_http` without `url`.
3. `validateV4Config()` rejects `streamable_http` with `command`, `args`, or `cwd`.
4. `validateV4Config()` rejects `stdio` runtimes that declare `url` or `headers`.
5. `dispatchMcp()` stages a valid turn result from a local streamable HTTP MCP server.
6. `dispatchMcp()` forwards configured static headers to the remote MCP server.
7. `dispatchMcp()` still fails clearly when the required tool is missing on a remote MCP server.
8. `agentxchain step` reports the correct MCP transport target instead of always claiming stdio.
9. Adapter docs document both `stdio` and `streamable_http` truthfully and do not claim SSE support in this slice.

## Open Questions

- Whether a later slice should add explicit deprecated `sse` compatibility for older MCP servers that cannot expose streamable HTTP.
- Whether remote MCP auth should remain static-header based or grow a first-class `auth_env` abstraction later.
