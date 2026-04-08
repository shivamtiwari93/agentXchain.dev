# MCP Real-Model Proof Spec

## Purpose

Close the last MCP evidence gap: prove that the MCP adapter works with a **real AI model** behind the MCP server, not just echo agents returning canned results.

## Approach

Build `examples/mcp-anthropic-agent/server.js` — an MCP stdio server that:

1. Receives the `agentxchain_turn` tool call (same 13-argument contract as the echo agent)
2. Calls the Anthropic Messages API with the rendered prompt + context
3. Extracts the turn-result JSON from the model response
4. Returns it via `structuredContent`

This follows the same pattern as `just-prompt` (720 stars on GitHub) — exposing model completions as MCP tools. No new dependency needed: raw `fetch` to `api.anthropic.com`, same as the api-proxy adapter.

## Why Not Use an Existing OSS MCP Server?

Researched 2026-04-08:
- **No credible OSS MCP server fronts a real model as a governed-turn tool.** MCP's design is tool-centric (servers expose tools, clients hold models).
- **Closest options** (`just-prompt`, `mcp-rubber-duck`) expose generic `prompt()` tools, not the `agentxchain_turn` contract.
- **The TypeScript MCP SDK** (`@modelcontextprotocol/sdk` v1.29) is mature and makes building a custom server ~150 lines.
- Building custom is the right call: the server must implement the exact `agentxchain_turn` contract and return a valid governed turn-result.

## Interface

### MCP Server Config (agentxchain.json)

```json
{
  "mcp-anthropic": {
    "type": "mcp",
    "command": "node",
    "args": ["./examples/mcp-anthropic-agent/server.js"],
    "tool_name": "agentxchain_turn",
    "env": {
      "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

### Environment Variables

- `ANTHROPIC_API_KEY` (required) — Anthropic API key
- `ANTHROPIC_MODEL` (optional, default: `claude-haiku-4-5-20251001`) — model to use
- `ANTHROPIC_MAX_TOKENS` (optional, default: `4096`) — max output tokens

### Tool Contract

Same 13 arguments as the echo agent. The server uses `prompt` and `context` fields to build the API request, and `run_id`, `turn_id`, `role`, `phase`, `runtime_id` for the turn-result identity fields.

## Behavior

1. Receive `agentxchain_turn` tool call
2. Build Anthropic Messages API request:
   - System prompt: same governed-agent system prompt as api-proxy adapter
   - User message: `prompt` + separator + `context`
   - Model: from env or default
3. Call `https://api.anthropic.com/v1/messages` via fetch
4. Extract turn-result JSON from the text content block (same extraction logic as api-proxy)
5. Inject identity fields (`run_id`, `turn_id`, `role`, `runtime_id`) if the model omits them
6. Return via `structuredContent`

## Error Cases

- Missing `ANTHROPIC_API_KEY`: return MCP tool error
- API call failure: return MCP tool error with status code and message
- Model returns non-JSON: return MCP tool error with diagnostic text
- Model returns JSON without `schema_version`: attempt to parse as partial turn result

## Acceptance Tests

1. Server starts and registers `agentxchain_turn` tool
2. Tool call with valid arguments returns a turn result with `schema_version: "1.0"`
3. Turn result contains identity fields matching the input arguments
4. Turn result passes the governed turn-result validator

## Dogfood Proof

Run the real MCP server through the governed CLI path:
1. Create temp workspace from `governed-todo-app`
2. Configure dev runtime as `type: "mcp"` pointing to the Anthropic server
3. Init run → assign PM → stage PM result → accept PM → approve planning gate
4. Run `agentxchain step --role dev` (dispatches through MCP adapter to real Anthropic server)
5. Verify exit code, staged result, and post-accept state
6. Record run_id, turn_id, model used, and cost

## Decision

- `DEC-MCP-REAL-MODEL-001`: Build a thin custom MCP server wrapping the Anthropic API rather than using an existing OSS server, because no OSS option implements the `agentxchain_turn` contract.
