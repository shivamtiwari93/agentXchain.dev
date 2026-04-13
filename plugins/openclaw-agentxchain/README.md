# @agentxchain/openclaw-plugin

OpenClaw plugin that exposes AgentXchain governance actions as OpenClaw skills.

## What it does

This plugin registers three tools inside OpenClaw:

| Tool | AgentXchain Command | Description |
|------|-------------------|-------------|
| `agentxchain_step` | `agentxchain step` | Execute a single governed turn step |
| `agentxchain_accept_turn` | `agentxchain accept-turn` | Accept the current turn result |
| `agentxchain_approve_transition` | `agentxchain approve-transition` | Approve a phase gate transition |

Each tool shells out to the `agentxchain` CLI installed on the host and returns structured output (success/failure, stdout, exit code).

## Prerequisites

- `agentxchain` CLI installed and on PATH (`npm install -g agentxchain`)
- OpenClaw >= 0.8.0
- A governed project directory with a valid `agentxchain.json`

## Install

```bash
# From the AgentXchain repo
cd plugins/openclaw-agentxchain
npm install
npm run build
```

Then register the plugin in your OpenClaw configuration:

```json
{
  "plugins": [
    {
      "name": "@agentxchain/openclaw-plugin",
      "path": "./plugins/openclaw-agentxchain"
    }
  ]
}
```

## Development

```bash
npm install
npm run build    # TypeScript → dist/
npm test         # Run tests
```

## License

MIT
