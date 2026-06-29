# MCP Anthropic Agent (Example)

An MCP server that implements the AgentXchain `agentxchain_turn` tool contract backed by the **real Anthropic Messages API**. Unlike the [echo agent](../mcp-echo-agent/), this server sends the rendered prompt and context to Claude and returns the model's actual turn-result JSON — proving the `mcp` runtime works end-to-end with real model completions.

## Prerequisites

- Node.js 18+
- An Anthropic API key

## Install

```bash
cd examples/mcp-anthropic-agent
npm install
```

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | yes | — | Anthropic API key |
| `ANTHROPIC_MODEL` | no | `claude-haiku-4-5-20251001` | Model to use |
| `ANTHROPIC_MAX_TOKENS` | no | `4096` | Max output tokens |

## Wire it into a governed project

Add an `mcp` runtime to your `agentxchain.json`, then bind a role to it:

```json
{
  "runtimes": {
    "mcp-anthropic": {
      "type": "mcp",
      "command": "node",
      "args": ["./examples/mcp-anthropic-agent/server.js"],
      "tool_name": "agentxchain_turn"
    }
  }
}
```

Run a governed turn (`agentxchain step` / `agentxchain run`). The server exposes a single MCP tool, `agentxchain_turn`, which receives the governed turn envelope and returns validated turn-result JSON produced by Claude.

## Related

- [`mcp-echo-agent`](../mcp-echo-agent/) — deterministic MCP agent (no API key)
- [`mcp-http-echo-agent`](../mcp-http-echo-agent/) — MCP over Streamable HTTP
- [MCP integration guide](https://agentxchain.dev/docs/integrations/mcp)
