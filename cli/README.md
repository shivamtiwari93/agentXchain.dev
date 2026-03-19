# agentxchain

CLI for multi-agent coordination in your IDE. Define a team of AI agents, let them take turns building your project via shared state and lifecycle hooks.

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
agentxchain init                      # create project with agents + hooks
cd my-project/ && code .              # open in VS Code / Cursor
# Select an agent from the Chat dropdown (auto-discovered from .github/agents/)
agentxchain release                   # release human lock to begin turns
```

The `Stop` hook acts as referee: when an agent finishes, it determines the next agent and hands off automatically. No polling process needed.

## Commands

| Command | What it does |
|---------|-------------|
| `init` | Create project folder with agents, hooks, protocol files, and templates |
| `generate` | Regenerate VS Code agent files (`.agent.md`, hooks) from `agentxchain.json` |
| `start` | Show agent setup instructions for your IDE |
| `status` | Show lock, phase, agents |
| `claim` | Human takes control |
| `release` | Hand lock back to agents |
| `stop` | Terminate running Claude Code agent sessions |
| `watch` | Fallback referee for non-IDE environments |
| `config` | View/edit config, add/remove agents, change rules |
| `update` | Self-update CLI from npm |

### Additional flags

```bash
agentxchain watch --daemon          # run watch in background
agentxchain release --force         # force-release non-human holder lock
```

## How it works

`agentxchain init` generates native VS Code agent files:

- `.github/agents/*.agent.md` — custom agents (auto-discovered by VS Code / Cursor Chat)
- `.github/hooks/agentxchain.json` — lifecycle hooks (Stop = referee, SessionStart = context injection)
- `scripts/agentxchain-*.sh` — hook shell scripts

When an agent finishes its response, the Stop hook reads `lock.json`, determines the next agent, and hands off automatically.

## Key features

- **Native VS Code agents** — `.agent.md` files, lifecycle hooks, handoffs
- **Works in any VS Code fork** — Cursor, VS Code, Windsurf, etc.
- **Stop hook referee** — deterministic turn coordination via lifecycle hooks
- **User-defined teams** — any number of agents, any roles
- **No API keys or cloud required** — everything runs locally
- **Human-in-the-loop** — claim/release to intervene anytime
- **Team templates** — SaaS MVP, Landing Page, Bug Squad, API Builder, Refactor Team

## VS Code extension (optional)

For a richer UI experience, install the extension:

```bash
code --install-extension cli/vscode-extension/agentxchain-0.1.0.vsix
```

Adds: status bar (lock holder, turn, phase), sidebar dashboard, command palette integration.

## Publish updates (maintainers)

```bash
cd cli
bash scripts/publish-npm.sh              # patch bump + publish
bash scripts/publish-npm.sh minor        # minor bump + publish
```

If `NPM_TOKEN` exists in `agentXchain.dev/.env` (project root), the script uses it automatically.

## Links

- [agentxchain.dev](https://agentxchain.dev)
- [GitHub](https://github.com/shivamtiwari93/agentXchain.dev)
- [Protocol v3 spec](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)

## License

MIT
