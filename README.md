# AgentXchain.dev — Open-source multi-agent coordination framework

Run a **software development team inside your IDE**. Define agents, launch them in separate windows, and let them take turns building your project — no central orchestrator, no API keys, no vendor lock-in.

```bash
npx agentxchain init
```

---

## Quick start

### Happy path: net-new project

```bash
npx agentxchain init
cd my-agentxchain-project   # default folder with init -y; or the folder name you chose
agentxchain kickoff
```

### Happy path: existing project

Run these commands from inside your existing project folder:

```bash
agentxchain doctor
agentxchain generate
agentxchain kickoff
```

Each agent runs in its own IDE window for one turn at a time. The referee loop (`watch` / `supervise --autonudge`) wakes the correct next agent session.
Each turn also appends a handoff update to `TALK.md` so humans and agents share one canonical conversation log.

---

## Install

**Run without installing** (recommended):
```bash
npx agentxchain init
```

**Install globally:**
```bash
npm install -g agentxchain
agentxchain --version
```

Requires **Node.js 18.17+ or 20.5+** (avoids dependency engine warnings). If `npm install -g` fails with permission errors, use `sudo npm install -g agentxchain@latest` or a user npm prefix; `agentxchain update` prints the same hints on failure.

**Update:**
```bash
agentxchain update
# or
npm install -g agentxchain@latest
```

---

## CLI commands

Complete command set:

```bash
agentxchain init
agentxchain status
agentxchain start
agentxchain kickoff
agentxchain stop
agentxchain config
agentxchain branch
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

### `agentxchain init`

Create a new project folder with all protocol files. Choose from team templates or define custom agents.

```bash
agentxchain init              # interactive setup
agentxchain init -y           # use defaults (pm, dev, qa, ux)
```

Templates available: **SaaS MVP**, **Landing Page**, **Bug Squad**, **API Builder**, **Refactor Team**, or **Custom**.

### `agentxchain start`

Open a separate IDE window per agent and copy each agent's prompt to clipboard.

```bash
agentxchain start                      # Cursor (default) — one window per agent
agentxchain start --ide vscode         # VS Code — uses .agent.md + hooks
agentxchain start --ide claude-code    # Claude Code — spawns CLI processes
agentxchain start --agent pm           # launch one specific agent only
agentxchain start --remaining          # launch all agents except PM (PM-first flow)
agentxchain start --dry-run            # preview agents without launching
agentxchain validate --mode kickoff    # required before --remaining
```

### `agentxchain kickoff`

Guided first-run workflow for PM-first collaboration:
1) launch PM, 2) validate signoff/docs, 3) launch remaining agents, 4) release lock, 5) optional auto-nudge supervisor.

```bash
agentxchain kickoff
agentxchain kickoff --send             # auto-send nudges in Cursor mode
agentxchain kickoff --ide vscode       # guided flow for VS Code
agentxchain kickoff --interval 2       # nudge poll interval override
agentxchain kickoff --no-autonudge     # skip auto-nudge prompt
```

### `agentxchain generate`

Regenerate VS Code agent files from `agentxchain.json`. Run after adding/removing agents.

```bash
agentxchain generate
```

### `agentxchain rebind`

Rebuild Cursor workspace bindings and prompts for current agents. Useful after changing agent IDs, renaming agents, or when auto-nudge can no longer map windows cleanly.

```bash
agentxchain rebind
agentxchain rebind --open      # regenerate + reopen all Cursor windows
agentxchain rebind --agent pm  # regenerate one agent binding only
```

### `agentxchain status`

Show current state: lock holder, phase, turn number, agents.

```bash
agentxchain status            # human-readable
agentxchain status --json     # machine-readable
```

### `agentxchain claim`

Human takes control. Agents stop claiming turns while you hold the lock.

```bash
agentxchain claim             # claim if lock is free
agentxchain claim --agent pm  # guarded claim for the specified agent turn
agentxchain claim --force     # override an agent's lock
```

### `agentxchain release`

Hand the lock back to agents.

```bash
agentxchain release
agentxchain release --agent pm # guarded release for the specified agent
agentxchain release --force   # force-release if non-human holder is stuck
```

### `agentxchain watch`

Optional safety net. Force-releases stale locks after TTL, logs turn transitions.

```bash
agentxchain watch
agentxchain watch --daemon
```

### `agentxchain supervise`

Runs `watch` and optional **macOS-only** AppleScript auto-nudge in one process. On Linux/Windows use `agentxchain watch` only (no `--autonudge`).

```bash
agentxchain supervise --autonudge
agentxchain supervise --autonudge --send   # auto-press Enter after paste
agentxchain supervise --interval 2          # set nudge poll interval
```

### `agentxchain stop`

Stops the project `watch` process if running (via PID file), terminates **Claude Code** child sessions from the session file, and removes `.agentxchain-session.json`. **Cursor / VS Code:** close agent chat windows yourself — the CLI does not close those apps.

```bash
agentxchain stop
```

### `agentxchain config`

View or edit project configuration.

```bash
agentxchain config                                    # show config
agentxchain config --add-agent                        # add a new agent
agentxchain config --remove-agent ux                  # remove an agent
agentxchain config --set "rules.max_consecutive_claims 3"
agentxchain config --set "rules.strict_next_owner true"
agentxchain config --set "rules.verify_command npm test"
agentxchain config --json                             # output as JSON
```

`rules.verify_command` should be a trusted local command such as `npm test` or `pnpm lint`.
Avoid shell pipelines or command chaining in this field.

### `agentxchain branch`

Show or set the Cursor branch override used for launches.

```bash
agentxchain branch
agentxchain branch feature/my-branch
agentxchain branch --use-current
agentxchain branch --unset
```

### `agentxchain update`

Self-update the CLI to the latest version.

```bash
agentxchain update
```

### `agentxchain doctor`

Check setup health: required tools, watch/trigger status, and accessibility hints.

```bash
agentxchain doctor
```

### `agentxchain validate`

Validate Get Shit Done and QA protocol artifacts.

```bash
agentxchain validate
agentxchain validate --mode kickoff
agentxchain validate --mode turn --agent pm
agentxchain validate --json
```

---

## How it works

### Cursor mode (default)

**First run:** `agentxchain kickoff` (PM window, validation, remaining agents, optional `supervise --autonudge`). **Later / ad-hoc:** `agentxchain start` or `agentxchain rebind` to refresh windows and prompts.

1. Each agent gets a **separate Cursor window** (per-agent `.code-workspace` under `.agentxchain-workspaces/`).
2. Prompts are copied to the clipboard; paste into chat, Agent mode, send.
3. Single-turn loop: claim → work → validate → release → stop.
4. Handoffs: write `Next owner:` in `TALK.md` (and optional `rules.strict_next_owner` for no fallback).
5. `claim` / `release` pause or resume anytime.

### VS Code mode

1. `agentxchain init` generates `.github/agents/*.agent.md` (VS Code custom agents) and `.github/hooks/` (lifecycle hooks).
2. VS Code auto-discovers agents in the Chat dropdown (requires GitHub Copilot).
3. The `Stop` hook acts as referee — hands off to next agent automatically.

### Turn ownership

Turns are handoff-driven by default:
- Each turn should append `Next owner: <agent_id>` in `TALK.md`
- `watch` / `supervise` dispatches the next trigger from that handoff when possible
- If `rules.strict_next_owner` is `true`, there is **no** cyclic fallback — missing/invalid handoff assigns the lock to **human** until `TALK.md` is fixed
- `claim --agent <id>` blocks out-of-turn claims unless `--force` is used

### Protocol v3 features

- **Referee-driven turns** — watcher/supervisor wakes the correct agent each turn
- **One window per agent** — separate Cursor windows via workspace symlinks
- **Claim-based turns** — agents coordinate via shared `lock.json`
- **User-defined agents** — any number, any roles, configured in one JSON file
- **No API keys or cloud required** — everything runs locally in your IDE
- **Lock TTL** — stale locks auto-released after timeout (default: 10 min)
- **Verify command** — agents must pass (e.g. `npm test`) before releasing
- **Human-in-the-loop** — `human` is a reserved holder; agents can pass to you
- **State/history split** — `state.md` (overwritten) + `history.jsonl` (append-only) prevents context blowup
- **Team templates** — presets for common team shapes (SaaS, landing page, bug squad, etc.)

Full spec: [PROTOCOL-v3.md](PROTOCOL-v3.md)

---

## `agentxchain.json` example

```json
{
  "version": 3,
  "project": "Mood tracking app",
  "agents": {
    "pm": {
      "name": "Product Manager",
      "mandate": "Quality uplift, purchase blockers, voice of customer."
    },
    "dev": {
      "name": "Fullstack Developer",
      "mandate": "Implement features, run tests, push back on vague requirements."
    },
    "qa": {
      "name": "QA Engineer",
      "mandate": "Test coverage, regression, acceptance criteria. File bugs."
    }
  },
  "log": "log.md",
  "talk_file": "TALK.md",
  "state_file": "state.md",
  "history_file": "history.jsonl",
  "rules": {
    "max_consecutive_claims": 2,
    "strict_next_owner": false,
    "ttl_minutes": 10,
    "verify_command": "npm test",
    "watch_interval_ms": 5000
  }
}
```

---

## How AgentXchain differs from MCP and A2A

| | **MCP** | **A2A (Google)** | **AgentXchain** |
|--|---------|-----------------|-----------------|
| **Purpose** | Agent ↔ tools/data | Agent ↔ agent over network | **Team in one shared workspace** |
| **Model** | One agent, many tools | Many agents, messages | **One team: lock, state, roles, turns** |
| **Best for** | Agent runs scripts | Agent calls another agent | **PM + Dev + QA ship a product** |

MCP and A2A don't give you an SDLC pipeline in one workspace. AgentXchain does.

---

## Examples

| Example | Agents | What it shows |
|---------|--------|---------------|
| [baby-tracker](examples/Baby%20Tracker/baby-tracker/) | eng-director, pm, backend, frontend, qa | Existing-project mapping + PM-first + referee-driven turns |

---

## Who this is for

- **Engineers who ship with AI** — comfortable with CLI, git, and AI-assisted coding. This adds multi-agent coordination.
- **Self-hosting teams** — full control, no hidden state, no vendor dependency.
- **Contributors** — protocol is open. Add IDE runners, new templates, or build tooling on top.

---

## Links

- **Website:** [agentxchain.dev](https://agentxchain.dev)
- **npm:** [npmjs.com/package/agentxchain](https://www.npmjs.com/package/agentxchain)
- **Protocol spec:** [PROTOCOL-v3.md](PROTOCOL-v3.md)
- **Seed prompt template:** [SEED-PROMPT.md](SEED-PROMPT.md)
- **AgentXchain.ai** (dashboard + apps): [agentxchain.ai](https://agentxchain.ai)

---

## License

MIT
