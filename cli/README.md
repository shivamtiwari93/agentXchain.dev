# agentxchain

CLI for multi-agent coordination in your IDE. Define a team of AI agents, launch them in Cursor / Claude Code / VS Code, and let them coordinate via a shared protocol.

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
# 1. Initialize a project (creates agentxchain.json, lock.json, state.json, log.md)
agentxchain init

# 2. Check status
agentxchain status

# 3. Launch agents in your IDE
agentxchain start --ide cursor

# 4. Stop agents
agentxchain stop
```

## Commands

### `agentxchain init`

Interactive setup. Creates all protocol files in the current directory.

- `-y, --yes` — skip prompts, use 4 default agents (pm, dev, qa, ux)

### `agentxchain status`

Show current lock holder, phase, turn number, and all agents.

- `-j, --json` — output as JSON

### `agentxchain start`

Launch agents in your IDE.

- `--ide <ide>` — target IDE: `cursor`, `claude-code`, `vscode` (default: cursor)
- `--agent <id>` — launch only one specific agent
- `--dry-run` — preview what would be launched

For Cursor Cloud Agents, set `CURSOR_API_KEY` in your environment. Without it, the CLI prints seed prompts you can paste manually.

### `agentxchain stop`

Stop all running agent sessions. Reads `.agentxchain-session.json` to find active agents.

### `agentxchain config`

View or edit project configuration.

- `--add-agent` — interactively add a new agent
- `--remove-agent <id>` — remove an agent by ID
- `--set "<key> <value>"` — update a setting (e.g. `--set "rules.max_consecutive_claims 3"`)
- `-j, --json` — output config as JSON

Examples:

```bash
agentxchain config                              # show current config
agentxchain config --add-agent                  # add a new agent
agentxchain config --remove-agent ux            # remove the ux agent
agentxchain config --set "project My New Name"  # change project name
agentxchain config --set "rules.compress_after_words 8000"
```

### `agentxchain update`

Update the CLI to the latest version from npm.

```bash
agentxchain update
```

## How it works

AgentXchain uses a **claim-based protocol**:

1. Agents are defined in `agentxchain.json` (name, mandate, rules)
2. A `lock.json` file tracks who holds the lock
3. When the lock is free, any agent can claim it
4. The agent does its work, logs a message, and releases the lock
5. Another agent claims. The cycle continues.

No fixed turn order. Agents self-organize. See [PROTOCOL-v3.md](https://agentxchain.dev) for the full spec.

## Links

- Website: [agentxchain.dev](https://agentxchain.dev)
- GitHub: [github.com/shivamtiwari93/agentXchain.dev](https://github.com/shivamtiwari93/agentXchain.dev)
- Protocol: [PROTOCOL-v3.md](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)

## License

MIT
