# AgentXchain.dev

Governed multi-agent software delivery for a single repo.

AgentXchain assigns one role at a time, requires a structured turn result, validates artifacts and verification claims, enforces phase gates, and keeps a human-readable collaboration log alongside append-only machine history.

The product is the protocol and orchestrator. IDE-window handoff remains available as a legacy compatibility mode, not the primary story.

## Install

Run without installing:

```bash
npx agentxchain init --governed
```

Or install globally:

```bash
npm install -g agentxchain
agentxchain --version
```

Requires Node.js 18.17+ or 20.5+.

## Quick Start

### New governed project

```bash
npx agentxchain init --governed
cd my-agentxchain-project
agentxchain status
agentxchain step --role pm
```

From there, the normal lifecycle is:

```bash
agentxchain approve-transition   # when a gate requires human sign-off
agentxchain step                 # continue the next governed turn
agentxchain approve-completion   # when final ship gate requires sign-off
```

### Migrate an existing legacy project

```bash
agentxchain migrate
agentxchain status
agentxchain step
```

## Governed Quickstart

Use [`examples/governed-todo-app/agentxchain.json`](examples/governed-todo-app/agentxchain.json) as the reference shape: PM plans, dev implements, QA reviews.

```bash
npx agentxchain init --governed
cd my-agentxchain-project
agentxchain step --role pm
```

In a second shell, open `.agentxchain/dispatch/current/PROMPT.md`. Copy the JSON template into `.agentxchain/staging/turn-result.json`, fill it in, then accept the turn. `validate --mode turn` is an optional preflight check for manual staging; `step` already validates internally.

```bash
# optional manual preflight:
agentxchain validate --mode turn
agentxchain accept-turn
agentxchain approve-transition
```

Continue the same loop for implementation and QA:

```bash
agentxchain step --role dev
# stage a valid dev turn result, then:
# optional manual preflight:
agentxchain validate --mode turn
agentxchain accept-turn

agentxchain step --role qa
# stage a valid QA review with run_completion_request: true, then:
# optional manual preflight:
agentxchain validate --mode turn
agentxchain accept-turn
agentxchain approve-completion
```

The live handoff is always in `.agentxchain/dispatch/current/`, and the orchestrator only accepts turn results staged at `.agentxchain/staging/turn-result.json`.

## Governed v4

Governed mode is the canonical AgentXchain surface.

- One repo per run
- One active turn at a time
- Orchestrator-owned state under `.agentxchain/`
- Structured turn results in `.agentxchain/staging/turn-result.json`
- Human-readable discussion in `TALK.md`
- Phase routing and exit gates enforced by the orchestrator
- Explicit accept, reject, transition-approval, and completion-approval commands

Default governed scaffolding creates:

```text
agentxchain.json
.agentxchain/state.json
.agentxchain/history.jsonl
.agentxchain/decision-ledger.jsonl
.agentxchain/prompts/
.agentxchain/staging/
.agentxchain/dispatch/
.planning/PM_SIGNOFF.md
.planning/ROADMAP.md
.planning/acceptance-matrix.md
.planning/ship-verdict.md
TALK.md
```

### Canonical command set

```bash
agentxchain init --governed
agentxchain migrate
agentxchain status
agentxchain resume
agentxchain step
agentxchain accept-turn
agentxchain reject-turn --reason "..."
agentxchain approve-transition
agentxchain approve-completion
```

### Runtime status today

- `manual` is working
- `local_cli` is working
- `api_proxy` is implemented for synchronous review-only turns and stages a provider-backed result during `step`

### Example governed lifecycle

```bash
agentxchain init --governed

# planning
agentxchain step --role pm
agentxchain approve-transition

# implementation
agentxchain step --role dev

# qa
agentxchain step --role qa
agentxchain approve-completion
```

Depending on gate configuration, some phase changes and run completion can auto-advance without a human approval step.

## Legacy v3 Compatibility

Legacy IDE-window coordination is still available for teams that want lock-based handoff in Cursor, VS Code, or Claude Code.

Primary legacy commands:

```bash
agentxchain init
agentxchain start
agentxchain kickoff
agentxchain watch
agentxchain supervise --autonudge
agentxchain claim
agentxchain release
agentxchain rebind
agentxchain generate
agentxchain branch
agentxchain validate
agentxchain doctor
agentxchain stop
```

Use this mode if you specifically want per-agent IDE sessions and lock-file coordination. For new projects, prefer governed v4.

## Command Groups

### Governed run control

- `init --governed`: scaffold a governed v4 project
- `migrate`: convert a legacy v3 project to governed v4
- `status`: inspect current run, phase, turn, and approval state
- `resume`: initialize or continue a governed run and assign the next turn
- `step`: run one governed turn end to end
- `accept-turn`: accept the staged governed turn result
- `reject-turn`: reject the staged result and retry or escalate
- `approve-transition`: approve a pending human-gated phase transition
- `approve-completion`: approve a pending human-gated run completion

### Shared project utilities

- `config`: inspect or edit project configuration
- `update`: update the CLI

### Legacy IDE orchestration

- `start`, `kickoff`, `watch`, `supervise`, `claim`, `release`, `rebind`, `generate`, `branch`, `validate`, `doctor`, `stop`

## How It Works

### Governed mode

1. The orchestrator initializes or resumes a run.
2. It assigns exactly one role for the current phase.
3. It writes a dispatch bundle for that turn.
4. The role completes work and emits a structured turn result.
5. The orchestrator validates schema, assignment, artifacts, verification, and protocol compliance.
6. Accepted turns can advance phase, pause for human sign-off, or complete the run.

### Legacy mode

1. Agents run in separate IDE sessions.
2. Coordination happens through `lock.json`, `state.json`, and `TALK.md`.
3. `watch` or `supervise` acts as the referee loop.

## Examples

| Example | What it shows |
|---|---|
| [governed-todo-app](examples/governed-todo-app/) | Governed v4 happy-path example using manual PM, local_cli dev, and api_proxy QA |
| [baby-tracker](examples/Baby%20Tracker/baby-tracker/) | Existing-project mapping, PM-first collaboration, and multi-agent workflow design |

## Positioning

AgentXchain is not an MCP replacement and not an agent-to-agent network protocol.

| | MCP | A2A | AgentXchain |
|---|---|---|---|
| Primary unit | tools/data access | networked agents | governed repo workflow |
| Core control model | one agent uses tools | agents message each other | orchestrator assigns the next turn |
| Best fit | tool calling | cross-service delegation | PM, dev, QA convergence on one codebase |

## Links

- Website: [agentxchain.dev](https://agentxchain.dev)
- npm: [npmjs.com/package/agentxchain](https://www.npmjs.com/package/agentxchain)
- Legacy spec: [PROTOCOL-v3.md](PROTOCOL-v3.md)
- Seed prompt template: [SEED-PROMPT.md](SEED-PROMPT.md)
- AgentXchain.ai: [agentxchain.ai](https://agentxchain.ai)

## License

MIT
