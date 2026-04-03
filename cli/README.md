# agentxchain

CLI for governed multi-agent software delivery.

The canonical mode is governed delivery: orchestrator-owned state, structured turn results, phase gates, mandatory challenge, and explicit human approvals where required.

Legacy IDE-window coordination is still shipped as a compatibility mode for teams that want lock-based handoff in Cursor, VS Code, or Claude Code.

## Docs

- [Quickstart](https://agentxchain.dev/docs/quickstart/)
- [CLI reference](https://agentxchain.dev/docs/cli/)
- [Adapter reference](https://agentxchain.dev/docs/adapters/)
- [Protocol spec (v6)](https://agentxchain.dev/docs/protocol/)
- [Why governed multi-agent delivery matters](https://agentxchain.dev/why/)

## Install

```bash
npm install -g agentxchain
```

Or run without installing:

```bash
npx agentxchain init --governed -y
```

## Testing

The CLI currently uses two runners on purpose: a narrow Vitest pilot for fast pure-unit feedback and `node --test` for the full suite.

```bash
npm run test:vitest
npm run test:node
npm test
```

- `npm run test:vitest`: 7 pilot files under Vitest
- `npm run test:node`: full integration, subprocess, and E2E suite
- `npm test`: both runners in sequence; this is the CI requirement today

The pilot keeps the same 7 files in both runners until a later slice explicitly decides how to reduce redundant execution. For watch mode, run `npx vitest`.

## Quick Start

### Governed workflow

```bash
npx agentxchain init --governed -y
cd my-agentxchain-project
git init
git add -A
git commit -m "initial governed scaffold"
agentxchain status
agentxchain step --role pm
```

If you want template-specific planning artifacts from day one:

```bash
npx agentxchain init --governed --template api-service -y
```

Built-in governed templates:

- `generic`: baseline governed scaffold
- `api-service`: API contract, operational readiness, error budget
- `cli-tool`: command surface, platform support, distribution checklist
- `web-app`: user flows, UI acceptance, browser support

`step` writes a turn-scoped bundle under `.agentxchain/dispatch/turns/<turn_id>/` and expects a staged result at `.agentxchain/staging/<turn_id>/turn-result.json`. Typical continuation:

```bash
agentxchain validate --mode turn
agentxchain accept-turn
agentxchain approve-transition
agentxchain step --role dev
agentxchain step --role qa
agentxchain approve-completion
```

Default governed scaffolding configures QA as `api_proxy` with `ANTHROPIC_API_KEY`. For a provider-free walkthrough, switch the QA runtime to `manual` before the QA step.

### Migrate a legacy project

```bash
agentxchain migrate
agentxchain status
agentxchain step
```

## Command Sets

### Governed

| Command | What it does |
|---|---|
| `init --governed [--template <id>]` | Create a governed project, optionally with project-shape-specific planning artifacts |
| `migrate` | Convert a legacy v3 project to governed format |
| `status` | Show current run, template, phase, turn, and approval state |
| `resume` | Initialize or continue a governed run and assign the next turn |
| `step` | Run one governed turn end to end or resume an active turn |
| `accept-turn` | Accept the staged governed turn result |
| `reject-turn` | Reject the staged result, retry, or reassign |
| `approve-transition` | Approve a pending human-gated phase transition |
| `approve-completion` | Approve a pending human-gated run completion |
| `validate` | Validate governed kickoff wiring, a staged turn, or both |
| `verify protocol` | Run the shipped protocol conformance suite against a target implementation |
| `dashboard` | Open the read-only governance dashboard in your browser for repo-local runs or multi-repo coordinator initiatives |
| `plugin install|list|remove` | Install, inspect, or remove governed hook plugins backed by `agentxchain-plugin.json` manifests |

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
| `doctor` | Check local environment and setup |
| `stop` | Stop watch daemon and local sessions |

## Governed Flow

1. `agentxchain step` initializes or resumes the run if needed.
2. It assigns the next role for the current phase.
3. It writes `.agentxchain/dispatch/turns/<turn_id>/`.
4. The assigned role writes `.agentxchain/staging/<turn_id>/turn-result.json`.
5. The orchestrator validates and either accepts, rejects, advances phase, pauses for approval, or completes the run.

## Protocol Conformance

AgentXchain ships a conformance kit under `.agentxchain-conformance/`. Use it to prove a runner or fork still implements the governed workflow contract:

```bash
agentxchain verify protocol --tier 3 --target .
```

Useful flags:

- `--tier 1|2|3`: maximum conformance tier to verify
- `--surface <name>`: isolate one surface such as `state_machine`, `dispatch_manifest`, or `coordinator`
- `--format json`: emit a machine-readable report for CI
- `--target <path>`: point at the root containing `.agentxchain-conformance/capabilities.json`

Important governed files:

```text
agentxchain.json
.agentxchain/state.json
.agentxchain/history.jsonl
.agentxchain/decision-ledger.jsonl
.agentxchain/dispatch/turns/<turn_id>/
.agentxchain/staging/<turn_id>/turn-result.json
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
- [Quickstart](https://agentxchain.dev/docs/quickstart/)
- [CLI reference](https://agentxchain.dev/docs/cli/)
- [Adapter reference](https://agentxchain.dev/docs/adapters/)
- [Protocol spec (v6)](https://agentxchain.dev/docs/protocol/)
- [GitHub](https://github.com/shivamtiwari93/agentXchain.dev)
- [Legacy Protocol v3 spec](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)

## License

MIT
