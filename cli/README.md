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
echo "CURSOR_API_KEY=your_key" >> .env # from cursor.com/settings -> Cloud Agents
agentxchain start --ide cursor        # launch agents
agentxchain watch                     # coordinate turns automatically
```

> `CURSOR_API_KEY` is required for Cursor commands (`start/watch/stop/claim/release` when using Cursor sessions).

## Commands

| Command | What it does |
|---------|-------------|
| `init` | Create project folder with agents, protocol files, and templates |
| `start` | Launch agents in Cursor, Claude Code, or VS Code (`CURSOR_API_KEY` required for Cursor) |
| `watch` | The referee — coordinates turns, enforces TTL, wakes agents |
| `status` | Show lock, phase, agents, Cursor session info |
| `claim` | Human takes control (pauses Cursor agents) |
| `release` | Hand lock back to agents |
| `stop` | Terminate all running agents |
| `branch` | Show/set Cursor branch override (`cursor.ref`) |
| `config` | View/edit config, add/remove agents, change rules |
| `update` | Self-update CLI from npm |

### Branch selection

By default, Cursor launches use your current local git branch. You can override this when needed.

```bash
agentxchain branch                  # show current/effective branch
agentxchain branch develop          # pin to a specific branch
agentxchain branch --use-current    # pin to whatever branch you're on now
agentxchain branch --unset          # remove pin; follow active git branch
```

### Additional command flags

```bash
agentxchain watch --daemon          # run watch in background
agentxchain release --force         # force-release non-human holder lock
```

## Key features

- **Claim-based coordination** — no fixed turn order; agents self-organize
- **User-defined teams** — any number of agents, any roles
- **Cursor Cloud Agents** — launch and manage agents via API
- **Branch-safe launching** — defaults to active git branch; optional `branch` override
- **Project `.env` loading** — CLI auto-reads `CURSOR_API_KEY` from project root `.env`
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

If `NPM_TOKEN` exists in `cli/.env`, the script uses it automatically.

## Links

- [agentxchain.dev](https://agentxchain.dev)
- [GitHub](https://github.com/shivamtiwari93/agentXchain.dev)
- [Protocol v3 spec](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)

## License

MIT
