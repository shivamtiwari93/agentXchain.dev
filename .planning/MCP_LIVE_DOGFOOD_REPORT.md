# MCP Live Dogfood Report

> Live proof that the MCP adapter works through the real governed CLI path for both stdio and streamable_http transports.

## Date

2026-04-07

## Stdio Transport Proof

- **Workspace**: `/tmp/axc-mcp-stdio-uYye8Q`
- **Run ID**: `run_5c008f7e6bc4b721`
- **Turn ID**: `turn_e41e35ba8eea9768`
- **Runtime**: `local-dev` (type: `mcp`, transport: `stdio`)
- **MCP Server**: `examples/mcp-echo-agent/server.js` (shipped reference implementation)
- **CLI Output**:
  ```
  Dispatching to MCP stdio: node
  Turn: turn_e41e35ba8eea9768  Role: dev  Phase: implementation  Tool: agentxchain_turn
    Connecting to MCP stdio server (node)
    Listing MCP tools
    Calling MCP tool "agentxchain_turn"
  MCP tool completed (agentxchain_turn). Staged result detected.
  Turn Accepted
  ```
- **Exit Code**: 0
- **Post-Accept State**:
  - `status: "active"`
  - `phase: "implementation"`
  - `last_completed_turn_id: "turn_e41e35ba8eea9768"`
  - `planning_signoff: "passed"`

## Streamable HTTP Transport Proof

- **Workspace**: `/tmp/axc-mcp-http-pCw0OG`
- **Run ID**: `run_210040f7b9437431`
- **Turn ID**: `turn_5292f4de9e01ea71`
- **Runtime**: `local-dev` (type: `mcp`, transport: `streamable_http`)
- **MCP Server**: `examples/mcp-http-echo-agent/server.js` on port 11274
- **URL**: `http://127.0.0.1:11274/mcp`
- **Custom Headers**: `x-agentxchain-project: mcp-live-dogfood`
- **CLI Output**:
  ```
  Dispatching to MCP streamable_http: http://127.0.0.1:11274/mcp
  Turn: turn_5292f4de9e01ea71  Role: dev  Phase: implementation  Tool: agentxchain_turn
    Connecting to MCP streamable_http server (http://127.0.0.1:11274/mcp)
    Listing MCP tools
    Calling MCP tool "agentxchain_turn"
  MCP tool completed (agentxchain_turn). Staged result detected.
  Turn Accepted
  ```
- **Exit Code**: 0
- **Post-Accept State**:
  - `status: "active"`
  - `phase: "implementation"`
  - `last_completed_turn_id: "turn_5292f4de9e01ea71"`
  - `planning_signoff: "passed"`

## What This Proves

1. The MCP adapter dispatches governed turns through the real `agentxchain step` CLI command
2. Both `stdio` and `streamable_http` transports work end to end
3. The MCP tool contract (13 arguments) is correctly marshalled and the result is correctly extracted
4. The turn result passes validation and is accepted by the governed state machine
5. History entries record the correct runtime_id for MCP-dispatched turns
6. Custom HTTP headers are forwarded for streamable_http transport

## What This Does NOT Prove

- A real AI model behind MCP (both use echo agents returning canned results)
- MCP adapter behavior under production-scale context or long-running turns
- MCP adapter failure recovery (timeout, crash, invalid result from a real model)
- Full governed lifecycle through MCP (only one dev turn per transport, not a complete run)

## Methodology

For each transport:
1. Copied `examples/governed-todo-app/` to a temp directory
2. Patched `agentxchain.json` to configure the dev runtime as `type: "mcp"`
3. Used governed-state library API to: init run → assign PM → stage PM result → accept PM → approve planning gate
4. Ran `agentxchain step --role dev` through the real CLI binary
5. Verified exit code, CLI output, and post-accept state
