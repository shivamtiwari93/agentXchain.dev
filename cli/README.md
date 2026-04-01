# agentxchain

CLI for governed multi-agent software delivery.

The canonical mode is governed v4: one active turn at a time, orchestrator-owned state, structured turn results, phase gates, and explicit human approvals where required.

Legacy IDE-window coordination is still shipped as a compatibility mode for teams that want lock-based handoff in Cursor, VS Code, or Claude Code.

## Install

```bash
npm install -g agentxchain
```

Or run without installing:

```bash
npx agentxchain init --governed
```

## Quick Start

### Governed v4

```bash
npx agentxchain init --governed
cd my-agentxchain-project
agentxchain status
agentxchain step --role pm
```

Typical continuation:

```bash
agentxchain approve-transition
agentxchain step
agentxchain approve-completion
```

### Migrate a legacy project

```bash
agentxchain migrate
agentxchain status
agentxchain step
```

## Command Sets

### Governed v4

| Command | What it does |
|---|---|
| `init --governed` | Create a governed v4 project |
| `migrate` | Convert a legacy v3 project to governed v4 |
| `status` | Show current run, phase, turn, and approval state |
| `resume` | Initialize or continue a governed run and assign the next turn |
| `step` | Run one governed turn end to end |
| `accept-turn` | Accept the staged governed turn result |
| `reject-turn` | Reject the staged result and retry or escalate |
| `approve-transition` | Approve a pending human-gated phase transition |
| `approve-completion` | Approve a pending human-gated run completion |

### Shared utilities

| Command | What it does |
|---|---|
| `config` | View or edit project configuration |
| `update` | Update the CLI from npm |

### Legacy v3 compatibility

| Command | What it does |
|---|---|
| `init` | Create a legacy project folder |
| `start` | Launch legacy agents in IDE sessions |
| `kickoff` | Guided PM-first legacy setup flow |
| `watch` | Referee loop for legacy lock-based handoff |
| `supervise` | Run `watch` plus optional macOS auto-nudge |
| `claim` / `release` | Human override of legacy lock ownership |
| `rebind` | Rebuild Cursor bindings |
| `generate` | Regenerate VS Code agent files |
| `branch` | Manage Cursor branch override for launches |
| `validate` | Validate legacy docs and turn protocol artifacts |
| `doctor` | Check local environment and setup |
| `stop` | Stop watch daemon and local sessions |

## Governed Flow

1. `agentxchain step` initializes or resumes the run if needed.
2. It assigns the next role for the current phase.
3. It writes `.agentxchain/dispatch/current/`.
4. The assigned role writes `.agentxchain/staging/turn-result.json`.
5. The orchestrator validates and either accepts, rejects, advances phase, pauses for approval, or completes the run.

Important governed files:

```text
agentxchain.json
.agentxchain/state.json
.agentxchain/history.jsonl
.agentxchain/decision-ledger.jsonl
.agentxchain/dispatch/current/
.agentxchain/staging/turn-result.json
TALK.md
.planning/
```

### Runtime support today

- `manual`: implemented
- `local_cli`: implemented
- `api_proxy`: implemented for synchronous review-only turns and stages a provider-backed result during `step`

## Legacy IDE Mode

Legacy mode is still useful if you specifically want one IDE session per agent and lock-file coordination.

```bash
agentxchain start                   # Cursor (default)
agentxchain start --ide vscode
agentxchain start --ide claude-code
agentxchain kickoff
agentxchain supervise --autonudge
```

In this mode, agents hand off through `lock.json`, `state.json`, triggers, and `TALK.md`. For new projects, prefer governed mode unless IDE-window choreography is the goal.

## macOS Auto-Nudge

`supervise --autonudge` is legacy-only and macOS-only.

```bash
agentxchain supervise --autonudge
agentxchain supervise --autonudge --send
```

Requires:

- `osascript`
- `jq`
- Accessibility permissions for Terminal and Cursor

## Links

- [agentxchain.dev](https://agentxchain.dev)
- [GitHub](https://github.com/shivamtiwari93/agentXchain.dev)
- [Legacy Protocol v3 spec](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)

## License

MIT
