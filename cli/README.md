# agentxchain

CLI for multi-agent coordination in your IDE. Define a team of AI agents, let them take turns building your project — each in its own IDE window.

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
# 1. Create a project (interactive template selection)
agentxchain init

# 2. Launch agents — opens a separate Cursor window per agent
cd my-project/
agentxchain start

# 3. For each window: paste the prompt (auto-copied to clipboard), select Agent mode, send
#    The CLI walks you through one agent at a time.

# 4. Release the human lock — agents start claiming turns
agentxchain release
```

Each agent runs in its own Cursor window with a self-polling loop. Agents check `lock.json` every 60 seconds, claim when it's their turn, do their work, release, and go back to waiting. No external referee needed.

## Commands

| Command | What it does |
|---------|-------------|
| `init` | Create project folder with agents, protocol files, and templates |
| `start` | Open a Cursor window per agent + copy prompts to clipboard |
| `generate` | Regenerate agent files from `agentxchain.json` |
| `status` | Show lock holder, phase, turn number, agents |
| `claim` | Human takes control (agents stop claiming) |
| `release` | Hand lock back to agents |
| `stop` | Terminate running Claude Code agent sessions |
| `watch` | Optional: TTL safety net + status logging |
| `config` | View/edit config, add/remove agents, change rules |
| `update` | Self-update CLI from npm |

### IDE options

```bash
agentxchain start                   # Cursor (default) — one window per agent
agentxchain start --ide vscode      # VS Code — uses .agent.md custom agents + hooks
agentxchain start --ide claude-code # Claude Code — spawns CLI processes
```

### Additional flags

```bash
agentxchain start --agent pm        # launch only one specific agent
agentxchain start --dry-run         # preview agents without launching
agentxchain watch --daemon          # run watch in background
agentxchain release --force         # force-release non-human holder lock
```

## How it works

### Cursor mode (default)

1. `agentxchain start` opens a **separate Cursor window** for each agent
2. Each window gets a unique prompt copied to clipboard
3. Agent prompts include a self-polling loop: read `lock.json` → check if it's my turn → claim → work → release → sleep 60s → repeat
4. Agents know their rotation order from `agentxchain.json` and only claim when the previous agent released
5. Human can `claim` to pause and `release` to resume anytime

### VS Code mode

1. `agentxchain init` generates `.github/agents/*.agent.md` (VS Code custom agents) and `.github/hooks/` (lifecycle hooks)
2. VS Code auto-discovers agents in the Chat dropdown
3. The `Stop` hook acts as referee — hands off to next agent automatically

### Turn rotation

Agents follow a round-robin order defined in `agentxchain.json`:
- PM waits for: lock free + last released by `human`, `null`, or last agent in rotation
- Dev waits for: lock free + last released by `pm`
- QA waits for: lock free + last released by `dev`
- And so on...

## Key features

- **One window per agent** — each agent has its own Cursor window and chat session
- **Self-polling coordination** — agents check `lock.json` every 60s, no external process needed
- **Works in Cursor, VS Code, Claude Code** — adapters for each IDE
- **User-defined teams** — any number of agents, any roles
- **No API keys or cloud required** — everything runs locally
- **Human-in-the-loop** — claim/release to intervene anytime
- **Team templates** — SaaS MVP, Landing Page, Bug Squad, API Builder, Refactor Team
- **Lock TTL** — `watch` can force-release stale locks as a safety net

## VS Code extension (optional)

For a richer UI in VS Code:

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
