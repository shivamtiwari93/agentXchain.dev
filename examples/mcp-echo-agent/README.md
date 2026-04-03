# MCP Echo Agent

Minimal [Model Context Protocol](https://modelcontextprotocol.io/) server that implements the `agentxchain_turn` tool contract. Use this as a starting point for building your own governed MCP agent.

## What it does

The echo agent receives a governed turn dispatch from AgentXchain and returns a valid turn result that echoes the assignment metadata. It does not modify files or run tests — it is a reference implementation showing the exact tool contract your MCP server must satisfy.

## Quick start

```bash
# From the repo root
cd examples/mcp-echo-agent
npm install
```

Then configure a runtime in your `agentxchain.json`:

```json
{
  "runtimes": {
    "mcp-echo": {
      "type": "mcp",
      "command": "node",
      "args": ["./examples/mcp-echo-agent/server.js"],
      "tool_name": "agentxchain_turn"
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
      "runtime": "mcp-echo"
    }
  }
}
```

Run a governed turn:

```bash
agentxchain step
```

The echo agent will return a completed turn result with a summary of what it received.

## Tool contract

The server exposes one tool: `agentxchain_turn`

**Arguments** (all strings, passed by the adapter):

| Argument | Description |
|----------|-------------|
| `run_id` | Current run identifier |
| `turn_id` | Current turn identifier |
| `role` | Assigned role for this turn |
| `phase` | Current governed phase |
| `runtime_id` | Runtime identifier from config |
| `project_root` | Absolute path to project root |
| `dispatch_dir` | Absolute path to dispatch turn directory |
| `assignment_path` | Absolute path to `ASSIGNMENT.json` |
| `prompt_path` | Absolute path to `PROMPT.md` |
| `context_path` | Absolute path to `CONTEXT.md` |
| `staging_path` | Where the adapter will write the staged result |
| `prompt` | Rendered `PROMPT.md` content |
| `context` | Rendered `CONTEXT.md` content |

**Return**: A valid turn-result object via `structuredContent` or as JSON in a text content block.

## Building a real agent

Replace the echo logic in `server.js` with your own:

1. Read the `prompt` and `context` to understand the assignment
2. Do the work (write code, run tests, review changes)
3. Return a turn result with real `files_changed`, `verification`, `decisions`, and `objections`

The adapter handles staging, validation, and acceptance — your tool just needs to return the result.
