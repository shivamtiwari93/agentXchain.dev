# AgentXchain.dev — Open-source multi-agent coordination framework

Run a **software development team inside your AI workspace**. Define agents, launch them in Cursor, and let them coordinate via a shared protocol — no central orchestrator, no vendor lock-in.

```bash
npx agentxchain init
```

---

## Quick start

```bash
# 1. Create a project (interactive template selection)
npx agentxchain init

# 2. cd into your project
cd my-project/

# 3. Set your Cursor API key
export CURSOR_API_KEY=your_key    # get from cursor.com/settings

# 4. Launch agents in Cursor
npx agentxchain start --ide cursor

# 5. Start the referee (coordinates turns automatically)
npx agentxchain watch
```

That's it. The watch process wakes agents when it's their turn, enforces timeouts, and handles deadlock recovery. You stay in control via `claim` and `release`.

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

Creates: `agentxchain.json`, `lock.json`, `state.json`, `state.md`, `history.jsonl`, `log.md`, `HUMAN_TASKS.md`

### `agentxchain start`

Launch agents in your IDE.

```bash
agentxchain start --ide cursor          # launch all agents via Cursor Cloud API
agentxchain start --ide cursor --agent pm   # launch one agent only
agentxchain start --ide claude-code     # spawn Claude CLI processes
agentxchain start --ide vscode          # print seed prompts for manual use
agentxchain start --dry-run             # preview without launching
```

Requires `CURSOR_API_KEY` for Cursor mode. The project must be in a GitHub repo.

### `agentxchain watch`

The referee. Coordinates agent turns automatically.

```bash
agentxchain watch
```

What it does:
- Polls `lock.json` every 5 seconds (configurable)
- When the lock is free, wakes the next agent via Cursor followup API
- Enforces lock TTL — force-releases stale locks after timeout
- Detects `holder: "human"` and sends you a notification
- Logs everything with timestamps and color-coded status

### `agentxchain status`

Show current state: lock holder, phase, turn number, agents, and Cursor session info.

```bash
agentxchain status            # human-readable
agentxchain status --json     # machine-readable
```

### `agentxchain claim`

Human takes control. Pauses all Cursor agents.

```bash
agentxchain claim             # claim if lock is free
agentxchain claim --force     # override an agent's lock
```

### `agentxchain release`

Hand the lock back to agents. Wakes the next agent automatically.

```bash
agentxchain release
```

### `agentxchain stop`

Terminate all running agent sessions.

```bash
agentxchain stop
```

Calls the Cursor DELETE API for each agent and removes the session file.

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

1. You create `agentxchain.json` — defines your agents (any number, any roles) and rules.
2. `agentxchain start` launches each agent as a Cursor Cloud Agent with a seed prompt.
3. `agentxchain watch` runs the coordination loop:
   - Lock is free → wake the next agent via followup API
   - Agent claims the lock, does its work, releases
   - Lock TTL expired → force-release and wake the next agent
   - Lock held by `human` → send notification, wait
4. Agents coordinate via `lock.json` (who holds the lock), `state.md` (living project state), and `history.jsonl` (turn log).
5. You can `claim` the lock to intervene, then `release` to hand back.

### Protocol v3 features

- **Claim-based turns** — no fixed order; agents self-organize
- **User-defined agents** — any number, any roles, configured in one JSON file
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
