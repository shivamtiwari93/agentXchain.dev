# SPEC: AgentXchain MCP Server

## Purpose

Expose AgentXchain's governance API as an MCP (Model Context Protocol) server so that any MCP-compatible tool (Claude Code, Cursor, Windsurf, VS Code extensions, etc.) can natively query run status, approve gates, read events, and interact with governed projects without going through the CLI.

Currently AgentXchain is an MCP **client** (the `mcp` adapter dispatches turns TO MCP servers). This spec adds the inverse: AgentXchain as an MCP **server** that exposes governance operations as MCP tools and state as MCP resources.

## Interface

### Command

```
agentxchain serve-mcp [--root <project-root>]
```

Starts a stdio-based MCP server. The server reads JSON-RPC messages from stdin and writes responses to stdout, per the MCP specification. The `--root` flag defaults to the current working directory.

### MCP Tools

| Tool Name | Description | Input Schema | Output |
|---|---|---|---|
| `agentxchain_status` | Read current project and run status | `{}` (no required args) | JSON: `{ project, run_id, phase, status, active_turns, pending_gates, idle_cycles }` |
| `agentxchain_events` | Read recent events from the governed project | `{ limit?: number }` (default 50) | JSON array of recent event objects |
| `agentxchain_history` | Read run history | `{ limit?: number }` (default 20) | JSON array of history entries |
| `agentxchain_approve_gate` | Approve a pending human gate | `{ gate_id: string, reason?: string }` | JSON: `{ ok, gate_id, phase_after?, error? }` |
| `agentxchain_intake_record` | Record a new intake event | `{ source: string, title: string, description?: string, priority?: string }` | JSON: `{ ok, intent_id?, error? }` |

### MCP Resources

| URI | Description |
|---|---|
| `agentxchain://state` | Current `.agentxchain/state.json` contents |
| `agentxchain://session` | Current `.agentxchain/continuous-session.json` contents (if exists) |

## Behavior

1. **Startup:** Server initializes by loading project context from `--root`. If no governed `agentxchain.json` exists, tools return descriptive errors rather than crashing the server.
2. **State reads:** `agentxchain_status`, `agentxchain_events`, `agentxchain_history`, and resource reads load fresh state from disk on every call. No caching — the source of truth is the filesystem.
3. **Gate approval:** `agentxchain_approve_gate` invokes the same code path as `agentxchain unblock <gate_id>`. The operation is idempotent (approving an already-approved gate returns success with a note).
4. **Intake recording:** `agentxchain_intake_record` invokes the same code path as `agentxchain intake record`.
5. **Transport:** stdio only for v1. Streamable HTTP transport is a future addition.
6. **Concurrency:** The server handles one request at a time (stdio is serial by nature). No concurrent state mutation.

## Error Cases

- No `agentxchain.json` at root: tools return `{ ok: false, error: "No governed project found at <root>" }`.
- No active run: `agentxchain_status` returns status with `run_id: null`.
- Invalid gate ID: `agentxchain_approve_gate` returns `{ ok: false, error: "Gate <id> not found" }`.
- File read errors: tools return descriptive errors, do not crash the server.

## Acceptance Tests

1. **AT-MCP-SRV-001:** `serve-mcp` starts, responds to MCP `initialize` handshake, and lists all 5 tools.
2. **AT-MCP-SRV-002:** `agentxchain_status` on a governed project returns valid status JSON with `run_id`, `phase`, `status` fields.
3. **AT-MCP-SRV-003:** `agentxchain_events` returns an array; `limit` parameter caps the result count.
4. **AT-MCP-SRV-004:** `agentxchain_history` returns an array of history entries.
5. **AT-MCP-SRV-005:** `agentxchain_approve_gate` on a pending gate returns `{ ok: true }` and the gate advances.
6. **AT-MCP-SRV-006:** `agentxchain_status` on a directory with no `agentxchain.json` returns a clear error.
7. **AT-MCP-SRV-007:** MCP resources `agentxchain://state` and `agentxchain://session` return valid JSON when files exist.

## Open Questions

1. Should the server emit `notifications/resources/updated` when it detects filesystem changes (via `fs.watch`)? Deferred to v2 — adds complexity without clear initial need.
2. Should `agentxchain_step` (run a single governed turn) be exposed as an MCP tool? Deferred — mutations beyond gate approval need careful scoping.
