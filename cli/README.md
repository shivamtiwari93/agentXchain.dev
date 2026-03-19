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

## Quick start — VS Code / Cursor (recommended)

No API keys or cloud connection needed. Uses native VS Code custom agents.

```bash
agentxchain init                      # create project with agents + hooks
cd my-project/ && code .              # open in VS Code / Cursor
# Select an agent from Chat dropdown (auto-discovered from .github/agents/)
agentxchain release                   # release human lock to begin turns
```

The `Stop` hook acts as referee: when an agent finishes, it hands off to the next agent automatically.

## Quick start — Cursor Cloud Agents

```bash
agentxchain init
cd my-project/
echo "CURSOR_API_KEY=your_key" >> .env # cursor.com/settings -> Cloud Agents
# Connect GitHub in Cursor Settings -> GitHub integration
agentxchain start --ide cursor        # launch cloud agents
agentxchain watch                     # coordinate turns
agentxchain release                   # begin turns (initial lock is human)
```

> `CURSOR_API_KEY` is required for Cloud commands. Your Cursor account needs GitHub access to the target repository.

## Commands

| Command | What it does |
|---------|-------------|
| `init` | Create project folder with agents, protocol files, hooks, and templates |
| `generate` | Regenerate VS Code agent files (`.agent.md`, hooks) from `agentxchain.json` |
| `start` | Launch agents in Cursor Cloud, Claude Code, or VS Code |
| `watch` | The referee for cloud mode — coordinates turns, enforces TTL, wakes agents |
| `status` | Show lock, phase, agents, Cursor session info |
| `claim` | Human takes control (pauses Cursor agents) |
| `release` | Hand lock back to agents |
| `stop` | Terminate all running cloud agents |
| `branch` | Show/set Cursor branch override (`cursor.ref`) |
| `config` | View/edit config, add/remove agents, change rules |
| `update` | Self-update CLI from npm |

### Branch selection

By default, Cursor launches use your current local git branch.

```bash
agentxchain branch                  # show current/effective branch
agentxchain branch develop          # pin to a specific branch
agentxchain branch --use-current    # pin to whatever branch you're on now
agentxchain branch --unset          # remove pin; follow active git branch
```

### Additional flags

```bash
agentxchain watch --daemon          # run watch in background
agentxchain release --force         # force-release non-human holder lock
```

## VS Code plugin

`agentxchain init` generates native VS Code agent files:

- `.github/agents/*.agent.md` — custom agents (auto-discovered by VS Code Chat)
- `.github/hooks/agentxchain.json` — lifecycle hooks (Stop = referee, SessionStart = context injection)
- `scripts/agentxchain-*.sh` — hook shell scripts

VS Code extension (optional, for UI):
- Status bar: lock holder, turn, phase (live-updated via file watcher)
- Sidebar: agent dashboard with quick actions
- Commands: Claim, Release, Status, Generate

Install the extension:
```bash
code --install-extension cli/vscode-extension/agentxchain-0.1.0.vsix
```

## Key features

- **Native VS Code agents** — `.agent.md` files, lifecycle hooks, handoffs
- **Claim-based coordination** — no fixed turn order; agents self-organize
- **Stop hook referee** — deterministic turn coordination via VS Code hooks
- **User-defined teams** — any number of agents, any roles
- **Cursor Cloud Agents** — launch and manage via API (optional)
- **Branch-safe launching** — defaults to active git branch
- **Lock TTL** — stale locks auto-released after timeout
- **Verify command** — agents must pass tests before releasing
- **Human-in-the-loop** — claim/release to intervene anytime
- **Team templates** — SaaS MVP, Landing Page, Bug Squad, API Builder, Refactor Team

## Publish updates (maintainers)

```bash
cd cli
bash scripts/publish-npm.sh              # patch bump + publish
bash scripts/publish-npm.sh minor        # minor bump + publish
bash scripts/publish-npm.sh 0.5.0        # explicit version + publish
bash scripts/publish-npm.sh patch --dry-run
```

If `NPM_TOKEN` exists in `agentXchain.dev/.env` (project root), the script uses it automatically.

## Links

- [agentxchain.dev](https://agentxchain.dev)
- [GitHub](https://github.com/shivamtiwari93/agentXchain.dev)
- [Protocol v3 spec](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)

## License

MIT
