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

### Happy path: net-new project

```bash
npx agentxchain init
cd my-agentxchain-project   # default with init -y, or your chosen folder name
agentxchain kickoff
```

### Happy path: existing project

Run these commands from inside your existing project folder:

```bash
agentxchain doctor
agentxchain generate
agentxchain kickoff
```

Each agent runs in its own Cursor window for a single turn at a time. The referee loop (`watch` / `supervise --autonudge`) determines the next agent and wakes that specific session.

Agents are now required to maintain `TALK.md` as the human-readable handoff log each turn.

## Commands

| Command | What it does |
|---------|-------------|
| `init` | Create project folder with agents, protocol files, and templates |
| `kickoff` | Guided PM-first flow: PM kickoff, validate, launch remaining, release |
| `start` | Open a Cursor window per agent + copy prompts to clipboard |
| `supervise` | Run watcher and optional AppleScript auto-nudge together |
| `generate` | Regenerate agent files from `agentxchain.json` |
| `validate` | Enforce PM signoff + waves/phases + turn artifact schema |
| `status` | Show lock holder, phase, turn number, agents |
| `doctor` | Validate local setup (tools, trigger flow, accessibility checks) |
| `claim` | Human takes control (agents stop claiming) |
| `release` | Hand lock back to agents |
| `stop` | Stop watch daemon, end Claude Code sessions; Cursor/VS Code chats close manually |
| `branch` | Show/set Cursor branch override for launches |
| `watch` | Referee loop: validates turns, writes next trigger, and force-releases stale locks |
| `config` | View/edit config, add/remove agents, change rules |
| `rebind` | Rebuild Cursor workspace/prompt bindings for agents |
| `update` | Self-update CLI from npm |

### Full command list

```bash
agentxchain init
agentxchain status
agentxchain start
agentxchain kickoff
agentxchain stop
agentxchain branch
agentxchain config
agentxchain rebind
agentxchain generate
agentxchain watch
agentxchain supervise
agentxchain claim
agentxchain release
agentxchain update
agentxchain doctor
agentxchain validate
```

### IDE options

```bash
agentxchain start                   # Cursor (default) — one window per agent
agentxchain start --ide vscode      # VS Code — uses .agent.md custom agents + hooks
agentxchain start --ide claude-code # Claude Code — spawns CLI processes
```

### Additional flags

```bash
agentxchain kickoff                # guided first-run PM-first workflow
agentxchain kickoff --ide vscode   # guided flow for VS Code mode
agentxchain kickoff --send         # with Cursor auto-nudge auto-send enabled
agentxchain kickoff --interval 2   # nudge poll interval override
agentxchain kickoff --no-autonudge # skip auto-nudge prompt

agentxchain start --agent pm        # launch only one specific agent
agentxchain start --remaining       # launch all agents except PM (PM-first flow)
agentxchain start --dry-run         # preview agents without launching
agentxchain validate --mode kickoff # required before --remaining
agentxchain validate --mode turn --agent pm
agentxchain validate --json         # machine-readable validation output
agentxchain watch --daemon          # run watch in background
agentxchain supervise --autonudge   # run watch + AppleScript nudge loop
agentxchain supervise --autonudge --send   # auto-press Enter after paste
agentxchain supervise --interval 2  # set auto-nudge poll interval
agentxchain rebind                  # regenerate agent prompt/workspace bindings
agentxchain rebind --open           # regenerate and reopen all Cursor agent windows
agentxchain rebind --agent pm       # regenerate one agent binding only
agentxchain claim --agent pm        # guarded claim as agent turn owner
agentxchain release --agent pm      # guarded release as agent turn owner
agentxchain release --force         # force-release non-human holder lock
agentxchain config --set "rules.strict_next_owner true"  # TALK-only next owner (no cyclic fallback)
```

## macOS auto-nudge (AppleScript)

**Recommended:** `agentxchain supervise --autonudge` (starts `watch` + auto-nudge together). Requires macOS, `jq`, and Accessibility for Terminal + Cursor.

```bash
agentxchain supervise --autonudge
agentxchain supervise --autonudge --send   # paste + Enter
```

**Advanced (debugging):** from a checkout of `cli/`, run the script alone while `watch` is already running:

```bash
bash scripts/run-autonudge.sh --project "/absolute/path/to/your-project" [--send]
bash scripts/stop-autonudge.sh
```

Notes:
- Requires macOS (`osascript`) and `jq` (`brew install jq`)
- Grant Accessibility permissions to Terminal and Cursor
- The script watches `.agentxchain-trigger.json`, which is written by `agentxchain watch`
- `run-autonudge.sh` now requires watch to be running first
- The script only nudges when it finds a unique matching agent window (no random fallback)

## How it works

### Cursor mode (default)

1. `agentxchain kickoff` launches PM first for human-product alignment
2. Each window gets a unique prompt copied to clipboard
3. Kickoff validates PM signoff and launches remaining agents
4. Agent prompts are single-turn: claim → work → validate → release → stop
5. Agents use the latest `Next owner:` in `TALK.md` to pick who goes next (fallback: config order)
6. Human can `claim` to pause and `release` to resume anytime

### VS Code mode

1. `agentxchain init` generates `.github/agents/*.agent.md` (VS Code custom agents) and `.github/hooks/` (lifecycle hooks)
2. VS Code discovers custom agents in Chat when using **GitHub Copilot** agents (see Microsoft docs)
3. The `Stop` hook acts as referee — hands off to next agent automatically

### Turn ownership

Agent turns are handoff-driven:
- Each turn appends a `Next owner:` in `TALK.md` with a valid agent id
- `watch`/`supervise` dispatches the next trigger from that handoff
- `claim --agent <id>` enforces that expected owner (with guarded fallback)

## Key features

- **One window per agent** — each agent has its own Cursor window and chat session
- **Referee-driven coordination** — `watch`/`supervise` wakes the next correct agent each turn
- **Works in Cursor, VS Code, Claude Code** — adapters for each IDE
- **User-defined teams** — any number of agents, any roles
- **No API keys or cloud required** — everything runs locally
- **Human-in-the-loop** — claim/release to intervene anytime
- **Team templates** — SaaS MVP, Landing Page, Bug Squad, API Builder, Refactor Team
- **Lock TTL** — `watch` can force-release stale locks as a safety net

## VS Code extension (optional)

The VSIX is not committed to the repo. Build/package from `cli/vscode-extension/` (see that folder’s README or `vsce package`), then:

```bash
code --install-extension /path/to/agentxchain-*.vsix
```

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
