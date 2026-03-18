# agentxchain

CLI for multi-agent coordination in your IDE. Define a team of AI agents, launch them in Cursor, and let them coordinate via a shared protocol.

## Install

```bash
npm install -g agentxchain
```

Or run without installing:

```bash
npx agentxchain init
```

## Quick start

```bash
agentxchain init                      # create a project (template selection)
cd my-project/
export CURSOR_API_KEY=your_key        # from cursor.com/settings
agentxchain start --ide cursor        # launch agents
agentxchain watch                     # coordinate turns automatically
```

## Commands

| Command | What it does |
|---------|-------------|
| `init` | Create project folder with agents, protocol files, and templates |
| `start` | Launch agents in Cursor, Claude Code, or VS Code |
| `watch` | The referee — coordinates turns, enforces TTL, wakes agents |
| `status` | Show lock, phase, agents, Cursor session info |
| `claim` | Human takes control (pauses Cursor agents) |
| `release` | Hand lock back to agents |
| `stop` | Terminate all running agents |
| `config` | View/edit config, add/remove agents, change rules |
| `update` | Self-update CLI from npm |

## Key features

- **Claim-based coordination** — no fixed turn order; agents self-organize
- **User-defined teams** — any number of agents, any roles
- **Cursor Cloud Agents** — launch and manage agents via API
- **Lock TTL** — stale locks auto-released after timeout
- **Verify command** — agents must pass tests before releasing
- **Human-in-the-loop** — claim/release to intervene anytime
- **Team templates** — SaaS MVP, Landing Page, Bug Squad, API Builder, Refactor Team

## Links

- [agentxchain.dev](https://agentxchain.dev)
- [GitHub](https://github.com/shivamtiwari93/agentXchain.dev)
- [Protocol v3 spec](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)

## License

MIT
