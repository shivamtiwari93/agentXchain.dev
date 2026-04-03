# Governed Todo App — AgentXchain Example

A minimal governed project demonstrating the full PM → Dev → QA lifecycle.

## What This Example Shows

- **Planning phase:** Manual PM turn creates roadmap and acceptance criteria
- **Implementation phase:** Local CLI dev turn builds the app and runs tests
- **QA phase:** API proxy QA turn reviews against acceptance matrix
- **Phase gates:** Human approval required at planning exit and ship verdict
- **Turn validation:** Orchestrator verifies files changed, verification evidence, and protocol compliance

## Prerequisites

- `agentxchain` CLI installed (`npm install -g agentxchain`)
- `claude` CLI installed (for local_cli dev turns)
- `ANTHROPIC_API_KEY` environment variable set (for api_proxy QA turns)
- Git initialized in this directory

## Quick Start

```bash
# 1. Initialize git (required for repo observation)
cd examples/governed-todo-app
git init && git add -A && git commit -m "initial scaffold"

# 2. Check project status
agentxchain status

# 3. Start a governed run — assigns PM turn (manual)
agentxchain step

# 4. Complete the PM turn manually:
#    - Edit .planning/ROADMAP.md with scope and acceptance criteria
#    - Edit .planning/PM_SIGNOFF.md with sign-off
#    - Use the turn ID/path printed by `step`
#    - Fill in .agentxchain/staging/<turn_id>/turn-result.json
#    - Optional preflight: agentxchain validate --mode turn
#    - Run: agentxchain accept-turn

# 5. Approve phase transition to implementation
agentxchain approve-transition

# 6. Run dev turn (dispatches to claude --print)
agentxchain step

# 7. After dev completes, run QA turn (dispatches to Anthropic API)
agentxchain step --role qa

# 8. Approve run completion
agentxchain approve-completion
```

## Runtime Configuration

| Role | Runtime | Type | Transport |
|------|---------|------|-----------|
| pm | manual-pm | manual | File handoff |
| dev | local-dev | local_cli | `claude --print -p {prompt}` |
| qa | api-qa | api_proxy | Anthropic API (review-only) |
| eng_director | manual-director | manual | File handoff |

## MCP Dev Variant

You do not need a second example project to try MCP. Swap the `dev` runtime in `agentxchain.json` to the shipped echo server:

```json
{
  "roles": {
    "dev": {
      "title": "Developer",
      "mandate": "Implement approved work safely and verify behavior.",
      "write_authority": "authoritative",
      "runtime": "local-dev"
    }
  },
  "runtimes": {
    "local-dev": {
      "type": "mcp",
      "command": "node",
      "args": ["../mcp-echo-agent/server.js"],
      "tool_name": "agentxchain_turn"
    }
  }
}
```

Then run:

```bash
agentxchain step --role dev
```

That path exercises the real MCP adapter against the governed todo app. The shipped echo server returns a validator-clean no-op result, so `step` can auto-accept the turn without modifying product files.

## Remote MCP Dev Variant (streamable HTTP)

For remote agents, start the [HTTP echo server](../mcp-http-echo-agent/) and point the dev runtime at it:

```bash
# In one terminal — start the remote MCP server
cd examples/mcp-http-echo-agent
npm install
node server.js  # listens on http://127.0.0.1:8787/mcp
```

```json
{
  "roles": {
    "dev": {
      "title": "Developer",
      "mandate": "Implement approved work safely and verify behavior.",
      "write_authority": "authoritative",
      "runtime": "local-dev"
    }
  },
  "runtimes": {
    "local-dev": {
      "type": "mcp",
      "transport": "streamable_http",
      "url": "http://127.0.0.1:8787/mcp",
      "tool_name": "agentxchain_turn",
      "headers": {
        "x-agentxchain-project": "governed-todo-app"
      }
    }
  }
}
```

Then run:

```bash
agentxchain step --role dev
```

This exercises the same governed tool contract over HTTP instead of stdio. Use this pattern when your agent runs as a remote service.

## Project Structure

```
governed-todo-app/
├── agentxchain.json          # Governed config
├── TALK.md                   # Human-readable collaboration log
├── .agentxchain/
│   ├── state.json            # Orchestrator-owned run state
│   ├── history.jsonl         # Append-only turn history
│   ├── decision-ledger.jsonl # Permanent decision record
│   ├── prompts/              # Role prompt templates
│   │   ├── pm.md
│   │   ├── dev.md
│   │   ├── qa.md
│   │   └── eng_director.md
│   ├── staging/              # Turn result staging area
│   ├── dispatch/             # Dispatch bundles (ephemeral)
│   └── reviews/              # QA/director review artifacts
├── .planning/
│   ├── PM_SIGNOFF.md         # PM sign-off document
│   ├── ROADMAP.md            # Roadmap with acceptance criteria
│   ├── acceptance-matrix.md  # QA acceptance verdict matrix
│   └── ship-verdict.md       # QA ship/no-ship verdict
└── .gitignore
```

## What "Governed" Means

Every turn produces a structured JSON result. The orchestrator independently verifies:
- What files actually changed (not just what the agent claimed)
- Whether verification commands actually passed
- Whether review-only roles stayed within their write authority
- Whether phase gate requirements are satisfied before advancing

No agent can advance the run state. Only the orchestrator can.
