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

# 2. Run guided PM-first kickoff wizard
cd my-project/
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
| `stop` | Terminate running Claude Code agent sessions |
| `watch` | Optional: TTL safety net + status logging |
| `config` | View/edit config, add/remove agents, change rules |
| `update` | Self-update CLI from npm |

### Full command list

```bash
agentxchain init
agentxchain status
agentxchain start
agentxchain kickoff
agentxchain stop
agentxchain config
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
agentxchain claim --agent pm        # guarded claim as agent turn owner
agentxchain release --agent pm      # guarded release as agent turn owner
agentxchain release --force         # force-release non-human holder lock
```

## macOS auto-nudge (AppleScript)

If you want the next agent chat to be nudged automatically when turn changes, use the built-in AppleScript helper.

1) Keep watcher running in your project:

```bash
agentxchain watch
# or use the combined command:
agentxchain supervise --autonudge
```

2) In another terminal (from `cli/`), start auto-nudge:

```bash
bash scripts/run-autonudge.sh --project "/absolute/path/to/your-project"
```

By default this is **paste-only** (safe mode): it opens chat and pastes the nudge message, but does not press Enter.

3) Enable auto-send once confirmed:

```bash
bash scripts/run-autonudge.sh --project "/absolute/path/to/your-project" --send
```

Stop it anytime:

```bash
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
5. Agents know their rotation order from `agentxchain.json` and only claim when the previous agent released
6. Human can `claim` to pause and `release` to resume anytime

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
- **Referee-driven coordination** — `watch`/`supervise` wakes the next correct agent each turn
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
