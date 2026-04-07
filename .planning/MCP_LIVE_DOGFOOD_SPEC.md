# MCP Live Dogfood Spec

> Spec for proving the MCP adapter works through the real governed CLI path, not just in test harnesses.

## Purpose

Close the last adapter evidence gap so launch surfaces can truthfully claim "all four adapters proven live." The existing `mcp-governed-example.test.js` proves MCP works in an automated test harness, but that is test-level proof, not live dogfood proof. This spec defines what counts as live MCP proof.

## What Counts As Live Proof

A governed turn must be dispatched through the real CLI (`agentxchain step`) using an MCP runtime, against a real MCP server process, and accepted by the governed state machine. Both transports must be proven:

1. **stdio transport**: `agentxchain step --role dev` dispatches to the shipped `mcp-echo-agent` via stdio subprocess
2. **streamable_http transport**: `agentxchain step --role dev` dispatches to the shipped `mcp-http-echo-agent` via HTTP

### Proof Artifacts Required

For each transport:
- The CLI must print the MCP dispatch line (e.g., `Dispatching to MCP stdio:` or `Dispatching to MCP streamable_http:`)
- The turn must be accepted (not rejected, not blocked)
- `state.json` must show the turn in `history` with the correct `runtime_id`
- `history.jsonl` must contain the accepted turn entry

### What This Does NOT Prove

- A real AI model behind MCP (the echo agent returns canned results)
- MCP adapter under production-scale context or long-running turns
- MCP adapter failure recovery (timeout, crash, invalid result)

This is transport-level proof: the governed runner can dispatch through MCP, receive a valid turn result, validate it, and accept it via the real CLI. This matches the proof level for `manual` (human-staged canned result) and exceeds it for transport verification.

## MCP Server / Transport

- **stdio**: `examples/mcp-echo-agent/server.js` — shipped reference implementation, uses `@modelcontextprotocol/sdk` `StdioServerTransport`
- **streamable_http**: `examples/mcp-http-echo-agent/server.js` — shipped reference implementation, uses `StreamableHTTPServerTransport` on a random port

## Expected Governed Turn Path

1. Copy `examples/governed-todo-app/` to a temp directory
2. Patch `agentxchain.json` to set `local-dev` runtime to `type: "mcp"` with the echo agent
3. `git init` + initial commit
4. `agentxchain init`
5. `agentxchain step --role pm` → stage PM artifacts manually → accept
6. `agentxchain approve-transition`
7. `agentxchain step --role dev` → dispatches to MCP echo agent → auto-accepts
8. Verify state shows accepted MCP turn in history

## Failure Modes

- MCP SDK not installed in example dir → `npm install` first
- Echo agent returns invalid turn result → product defect, fix before claiming proof
- Validator rejects echo result → product defect, fix before claiming proof
- Transport connection failure → environment issue, retry

## Acceptance Tests

1. stdio MCP turn accepted through real CLI with `exit_code = 0`
2. streamable_http MCP turn accepted through real CLI with `exit_code = 0`
3. Both transports show correct runtime_id in history
4. Launch evidence updated only after both transports proven
