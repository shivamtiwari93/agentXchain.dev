# MCP HTTP Echo Agent

Minimal [Model Context Protocol](https://modelcontextprotocol.io/) server that implements the `agentxchain_turn` tool contract over **streamable HTTP** transport. This is the remote counterpart of the [stdio MCP echo agent](../mcp-echo-agent/).

## What it does

The HTTP echo agent listens on an HTTP endpoint and responds to governed turn dispatches from AgentXchain. It returns a validator-clean turn result that echoes the assignment metadata. Like the stdio variant, it does not modify files or run tests. It exists to prove the remote MCP transport and governed turn contract.

## When to use this vs. the stdio variant

| | stdio (`mcp-echo-agent`) | HTTP (`mcp-http-echo-agent`) |
|---|---|---|
| **Transport** | Local subprocess | HTTP endpoint |
| **Use case** | Same-machine agents | Remote agents, hosted services |
| **Lifecycle** | Spawned per-turn by the adapter | Long-running server |
| **Config key** | `command`, `args` | `url`, `headers` |

Use the stdio variant for local development. Use this HTTP variant when your agent runs as a remote service (separate machine, container, cloud function).

## Quick start

```bash
# From the repo root
cd examples/mcp-http-echo-agent
npm install

# Start the server (default: http://127.0.0.1:8787/mcp)
node server.js

# Or with a custom port
node server.js --port 9000
PORT=9000 node server.js
```

Then configure a runtime in your `agentxchain.json`:

```json
{
  "runtimes": {
    "mcp-remote": {
      "type": "mcp",
      "transport": "streamable_http",
      "url": "http://127.0.0.1:8787/mcp",
      "tool_name": "agentxchain_turn",
      "headers": {
        "x-agentxchain-project": "my-project"
      }
    }
  }
}
```

Bind a role to it:

```json
{
  "roles": {
    "dev": {
      "title": "Developer",
      "mandate": "Implement approved work.",
      "write_authority": "authoritative",
      "runtime": "mcp-remote"
    }
  }
}
```

Run a governed turn:

```bash
agentxchain step --role dev
```

The echo agent will return a completed no-op turn result. The result is intentionally minimal but valid for governed acceptance.

## Tool contract

Same as the [stdio echo agent](../mcp-echo-agent/README.md#tool-contract). The server exposes one tool: `agentxchain_turn` with the same 13 arguments and the same `structuredContent` return format.

The only difference is transport: this server receives tool calls over HTTP POST to `/mcp` instead of stdio.

## Server behavior

- **Endpoint:** `POST /mcp` (all other paths return 404)
- **Stateless:** Each request creates a fresh MCP server instance. No session persistence.
- **Headers:** The adapter forwards any `headers` from the runtime config. Use this for auth tokens, project identifiers, or routing.
- **Graceful shutdown:** Ctrl+C stops the server.

## Building a real remote agent

Replace the echo logic in `server.js` with your own:

1. Read the `prompt` and `context` arguments to understand the assignment
2. Do the work (write code, run tests, review changes)
3. Return a turn result with real `files_changed`, `verification`, `decisions`, and `objections`

For production deployments, consider adding:
- Authentication middleware (validate `headers` from the config)
- Health check endpoint
- Structured logging
- Graceful shutdown with in-flight request draining
