# AgentXchain.dev — Open-source multi-agent coordination framework

Run a **software development team inside your AI workspace**. Define agents, let them take turns building your project via shared state — no central orchestrator, no API keys, no vendor lock-in.

```bash
npx agentxchain init
```

---

## Quick start

```bash
# 1. Create a project
npx agentxchain init

# 2. Open in VS Code / Cursor
cd my-project/ && code .

# 3. Select an agent from the Chat dropdown (e.g. "Product Manager")
#    Agents auto-discovered from .github/agents/

# 4. Release the lock to begin (new projects start with human lock)
npx agentxchain release

# 5. Agents coordinate via hooks — Stop hook hands off to next agent automatically
```

The `Stop` hook acts as the referee: when an agent finishes, it determines the next agent and hands off. No polling process needed.

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

Creates: `agentxchain.json`, `lock.json`, `state.json`, `state.md`, `history.jsonl`, `log.md`, `HUMAN_TASKS.md`, `.github/agents/*.agent.md`, `.github/hooks/`, `scripts/`

### `agentxchain generate`

Regenerate VS Code agent files from `agentxchain.json`. Run after adding/removing agents or changing config.

```bash
agentxchain generate
```

### `agentxchain start`

Show agent setup instructions for your IDE.

```bash
agentxchain start                      # show VS Code / Cursor instructions
agentxchain start --ide claude-code    # spawn Claude CLI processes
agentxchain start --dry-run            # preview agents without launching
```

### `agentxchain watch`

Fallback referee for non-IDE environments. In VS Code / Cursor, the Stop hook handles turn coordination automatically.

```bash
agentxchain watch
agentxchain watch --daemon
```

### `agentxchain status`

Show current state: lock holder, phase, turn number, agents.

```bash
agentxchain status            # human-readable
agentxchain status --json     # machine-readable
```

### `agentxchain claim`

Human takes control.

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

1. `agentxchain init` creates `agentxchain.json`, protocol files, and VS Code native agent files.
2. VS Code / Cursor auto-discovers `.github/agents/*.agent.md` as custom agents in the Chat dropdown.
3. Select an agent to start a turn. The agent reads `lock.json`, claims it, does its work, and releases.
4. The `Stop` hook (`.github/hooks/`) acts as referee: when an agent finishes, the hook determines the next agent and hands off automatically.
5. Agents coordinate via `lock.json` (who holds the lock), `state.md` (living project state), and `history.jsonl` (turn log).
6. Use `agentxchain claim` to intervene, `agentxchain release` to hand back.

### Protocol v3 features

- **Native VS Code agents** — `.agent.md` files auto-discovered by VS Code, Cursor, and other VS Code forks
- **Lifecycle hooks** — `Stop` hook acts as referee, `SessionStart` injects context, `PreToolUse` gates write access
- **Claim-based turns** — agents coordinate via shared `lock.json`
- **User-defined agents** — any number, any roles, configured in one JSON file
- **Handoffs** — agents hand off to the next agent automatically via VS Code handoff buttons
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
