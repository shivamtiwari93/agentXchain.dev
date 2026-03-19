# AgentXchain.dev — Open-source multi-agent coordination framework

Run a **software development team inside your IDE**. Define agents, launch them in separate windows, and let them take turns building your project — no central orchestrator, no API keys, no vendor lock-in.

```bash
npx agentxchain init
```

---

## Quick start

```bash
# 1. Create a project (interactive template selection)
npx agentxchain init

# 2. Launch agents — opens a separate Cursor window per agent
cd my-project/
agentxchain start

# 3. For each window the CLI opens:
#    - Paste the prompt (auto-copied to clipboard) into chat
#    - Select Agent mode
#    - Send it
#    The CLI walks you through one agent at a time.

# 4. Release the human lock — agents start claiming turns
agentxchain release
```

Each agent runs in its own IDE window with a self-polling loop. Agents check `lock.json` every 60 seconds, claim when it's their turn, do their work, release, and go back to waiting.

---

## Install

**Run without installing** (recommended):
```bash
npx agentxchain init
```

**Install globally:**
```bash
sudo npm install -g agentxchain
agentxchain --version
```

**Update:**
```bash
agentxchain update
# or
sudo npm install -g agentxchain@latest
```

---

## CLI commands

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
agentxchain start --dry-run            # preview agents without launching
```

### `agentxchain generate`

Regenerate VS Code agent files from `agentxchain.json`. Run after adding/removing agents.

```bash
agentxchain generate
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
agentxchain claim --force     # override an agent's lock
```

### `agentxchain release`

Hand the lock back to agents.

```bash
agentxchain release
agentxchain release --force   # force-release if non-human holder is stuck
```

### `agentxchain watch`

Optional safety net. Force-releases stale locks after TTL, logs turn transitions.

```bash
agentxchain watch
agentxchain watch --daemon
```

### `agentxchain stop`

Terminate running Claude Code agent sessions.

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
agentxchain config --set "rules.verify_command npm test"
agentxchain config --json                             # output as JSON
```

### `agentxchain update`

Self-update the CLI to the latest version.

```bash
agentxchain update
```

---

## How it works

### Cursor mode (default)

1. `agentxchain start` opens a **separate Cursor window** for each agent (via workspace symlinks).
2. Each agent's prompt is copied to clipboard. You paste into chat, select Agent mode, and send.
3. Agent prompts include a self-polling loop: read `lock.json` -> check turn -> claim -> work -> release -> `sleep 60` -> repeat.
4. Agents know their rotation order from `agentxchain.json` and only claim when the previous agent released.
5. You can `claim` to pause and `release` to resume anytime.

### VS Code mode

1. `agentxchain init` generates `.github/agents/*.agent.md` (VS Code custom agents) and `.github/hooks/` (lifecycle hooks).
2. VS Code auto-discovers agents in the Chat dropdown (requires GitHub Copilot).
3. The `Stop` hook acts as referee — hands off to next agent automatically.

### Turn rotation

Agents follow round-robin order defined in `agentxchain.json`:
- **PM** claims after: `human`, `null`, or last agent in rotation
- **Dev** claims after: `pm`
- **QA** claims after: `dev`
- And so on — wraps back to PM after the last agent

### Protocol v3 features

- **Self-polling agents** — each agent runs an infinite loop in its own IDE window
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
  "state_file": "state.md",
  "history_file": "history.jsonl",
  "rules": {
    "max_consecutive_claims": 2,
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
| [mood-tracking-app](examples/mood-tracking-app/) | pm, dev, qa, ux | Standard 4-agent SDLC team |
| [saas-landing-page](examples/saas-landing-page/) | pm, designer, frontend, copywriter, qa, devops | 6 agents, non-engineering roles |

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
