# MCP Stdio Adapter Spec

## Purpose

Add a governed `mcp` runtime type that dispatches turns to a local Model Context Protocol server over stdio.

This slice advances `VISION.md` Layer 3 (connectors) without pretending that "any MCP server" is an agent runtime. The adapter is only valid when the target server exposes an explicit governed-turn tool contract.

## Scope

### In Scope

- New governed runtime type: `mcp`
- Stdio-only MCP transport in v1
- Explicit required tool contract for governed turn execution
- `agentxchain step` integration
- Config validation, adapter tests, docs updates

### Out Of Scope

- Streamable HTTP MCP transport
- Sampling, elicitation, prompts, resources, or tasks
- Arbitrary tool orchestration across multiple MCP tools
- Claiming generic compatibility with every MCP server

## Interface

### Runtime Config

```json
{
  "runtimes": {
    "mcp-dev": {
      "type": "mcp",
      "command": "node",
      "args": ["./scripts/mcp-agent.js"],
      "tool_name": "agentxchain_turn",
      "cwd": "."
    }
  }
}
```

### Required Fields

- `type`: must be `"mcp"`
- `command`: non-empty string or non-empty string array

### Optional Fields

- `args`: string array when `command` is a string
- `tool_name`: MCP tool to call; defaults to `agentxchain_turn`
- `cwd`: working directory relative to project root

### MCP Tool Contract

The target server MUST expose one MCP tool whose name matches `tool_name`.

The adapter calls that tool with this argument object:

```json
{
  "run_id": "run_...",
  "turn_id": "turn_...",
  "role": "dev",
  "phase": "implementation",
  "runtime_id": "mcp-dev",
  "project_root": "/abs/path/project",
  "dispatch_dir": "/abs/path/project/.agentxchain/dispatch/turns/turn_...",
  "assignment_path": "/abs/path/project/.agentxchain/dispatch/turns/turn_.../ASSIGNMENT.json",
  "prompt_path": "/abs/path/project/.agentxchain/dispatch/turns/turn_.../PROMPT.md",
  "context_path": "/abs/path/project/.agentxchain/dispatch/turns/turn_.../CONTEXT.md",
  "staging_path": "/abs/path/project/.agentxchain/staging/turn_.../turn-result.json",
  "prompt": "... rendered prompt markdown ...",
  "context": "... rendered context markdown ..."
}
```

The tool MUST return a valid AgentXchain turn-result payload either:

- as `structuredContent`, or
- as JSON text in the first `text` content block

The adapter stages the returned payload at the standard staging path. The tool does not need to write the staging file itself.

## Behavior

### Dispatch

1. Verify the dispatch bundle manifest.
2. Spawn the configured MCP stdio server.
3. Initialize the MCP client connection.
4. Confirm `tool_name` is present in `tools/list`.
5. Call the tool with the governed turn payload.
6. Extract a turn-result object from the tool response.
7. Write the turn result to `.agentxchain/staging/<turn_id>/turn-result.json`.

### Wait

This adapter is synchronous in v1. `dispatch` and `wait` are the same operation, like `api_proxy`.

### Collect

The orchestrator uses the existing staged-result validation and acceptance flow. The MCP adapter does not bypass protocol validation.

## Error Cases

- No active turn: adapter fails immediately
- Runtime missing: adapter fails immediately
- Missing dispatch bundle: adapter fails immediately
- MCP server spawn/connect failure: adapter returns dispatch error
- Required tool missing from `tools/list`: adapter returns dispatch error naming the tool
- Tool call returns no extractable turn-result payload: adapter returns dispatch error
- Tool returns invalid JSON text: adapter returns dispatch error
- Tool response is empty: adapter returns dispatch error

## Acceptance Tests

1. Valid `mcp` runtime config passes validation.
2. Missing `command` on `mcp` runtime fails validation.
3. `step` dispatch path recognizes `mcp` runtimes as synchronous adapters.
4. Adapter fails clearly when the configured tool is absent.
5. Adapter stages returned `structuredContent` as turn-result JSON.
6. Adapter stages returned JSON text content as turn-result JSON.
7. Adapter fails clearly when the tool response cannot be parsed into a turn result.
8. Verification normalization treats `mcp` like an executable runtime, not an attested-only runtime.
