# AgentXchain.dev

Governed multi-agent software delivery for long-horizon coding, with single-repo workflows by default and multi-repo coordination in v2.

AgentXchain runs sequential turns by default and can optionally run parallel governed turns, always requiring a structured turn result, validating artifacts and verification claims, enforcing phase gates, and keeping a human-readable collaboration log alongside append-only machine history.

The product is the protocol and runner. Agents are required to challenge each other, humans retain authority at phase and ship gates, and every turn leaves an audit trail. AgentXchain.dev is the open-source surface for the protocol, connectors, workflows, and implementation evidence; AgentXchain.ai is the managed cloud surface for teams that want hosted infrastructure and integrations.

## What It Does

- Requires a structured turn result for every governed turn
- Enforces mandatory challenge, phase gates, and human approvals
- Records accepted history in append-only JSONL plus `TALK.md`
- Supports `manual`, `local_cli`, and `api_proxy` runtimes under the same workflow
- Runs sequentially by default, with optional parallel governed turns up to the configured cap
- Adds multi-repo coordinator flow with `agentxchain multi step`, `agentxchain multi approve-gate`, cross-repo context, and coordinator hooks
- Adds governed plugin install/list/remove commands for packaging hook integrations without forking core config

## Docs

- [Quickstart](https://agentxchain.dev/docs/quickstart/)
- [CLI reference](https://agentxchain.dev/docs/cli/)
- [Adapter reference](https://agentxchain.dev/docs/adapters/)
- [Protocol spec (v6)](https://agentxchain.dev/docs/protocol/)
- [Why governed multi-agent delivery matters](https://agentxchain.dev/why/)

## Install

Run without installing:

```bash
npx agentxchain init --governed -y
```

Or install globally:

```bash
npm install -g agentxchain
agentxchain --version
```

Requires Node.js 18.17+ or 20.5+.

## Testing

The CLI now ships a 30-file Vitest coexistence slice alongside the existing `node --test` suite.

```bash
cd cli
npm run test:vitest
npm run test:node
npm test
```

- `npm run test:vitest`: fast-feedback Vitest slice for the current 30 covered files
- `npm run test:node`: full authoritative suite, including integration, subprocess, and E2E coverage
- `npm test`: runs both sequentially and is the CI contract right now

Duplicate execution remains intentional for the current 30-file slice while the migration is still proving runner agreement on deeper stateful tests. For local watch mode, use `cd cli && npx vitest`.

## Quick Start

### New governed project

```bash
npx agentxchain init --governed -y
cd my-agentxchain-project
git init
git add -A
git commit -m "initial governed scaffold"
agentxchain status
agentxchain step --role pm
```

If you want scaffold intent captured up front, choose a governed template:

```bash
npx agentxchain init --governed --template web-app -y
```

Built-in governed templates:

- `generic`: baseline governed scaffold
- `api-service`: adds API contract, operational readiness, and error-budget planning files
- `cli-tool`: adds command-surface, platform-support, and distribution planning files
- `web-app`: adds user-flow, UI acceptance, and browser-support planning files

`step` writes a turn-scoped dispatch bundle under `.agentxchain/dispatch/turns/<turn_id>/` and tells you where the staged result must be written. For manual turns, fill in `.agentxchain/staging/<turn_id>/turn-result.json`, then accept the turn:

```bash
# optional manual preflight
agentxchain validate --mode turn
agentxchain accept-turn
agentxchain approve-transition

agentxchain step --role dev
agentxchain step --role qa
agentxchain approve-completion
```

Default governed scaffolding configures QA as `api_proxy` with `ANTHROPIC_API_KEY`. For a provider-free walkthrough, switch the QA runtime to `manual` before the QA step.

The governed flow is always: assign, stage a structured result, accept or reject, then satisfy any human gate before the next phase can advance.

### Migrate an existing legacy project

```bash
agentxchain migrate
agentxchain status
agentxchain step
```

## Governed Model

- One repo per run
- Orchestrator-owned state under `.agentxchain/`
- Turn-scoped dispatch and staging paths
- Human-readable collaboration in `TALK.md`
- Phase routing and exit gates enforced by the orchestrator
- Explicit accept, reject, transition-approval, completion-approval, and conflict-recovery commands

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

Use [`examples/governed-todo-app/`](examples/governed-todo-app/) as the reference project shape: PM plans, dev implements, QA reviews.

## 1.0 To 1.1 Compatibility

Existing `1.0` governed projects run unchanged under `1.1` defaults.

- Sequential behavior remains the default: if `routing.<phase>.max_concurrent_turns` is omitted or `1`, only one turn runs at a time.
- `api_proxy` retry stays opt-in via `runtime.retry_policy.enabled = true`.
- Preemptive tokenization stays opt-in via `runtime.preflight_tokenization.enabled = true` plus `context_window_tokens`.
- Automatic v1.1 improvements are limited to better provider error mapping and first-class `blocked` state visibility.

What changes operationally in v1.1:

- Dispatch and staging are now turn-scoped: `.agentxchain/dispatch/turns/<turn_id>/` and `.agentxchain/staging/<turn_id>/turn-result.json`.
- If multiple turns are active, use `--turn <id>` with `step --resume`, `accept-turn`, and `reject-turn`.
- Conflict recovery is explicit:
  - `agentxchain reject-turn --turn <id> --reassign`
  - `agentxchain accept-turn --turn <id> --resolution human_merge`

## Canonical Governed Commands

```bash
agentxchain init --governed
agentxchain migrate
agentxchain status
agentxchain resume
agentxchain resume --turn <id>
agentxchain step
agentxchain step --resume --turn <id>
agentxchain accept-turn --turn <id> --resolution human_merge
agentxchain reject-turn --turn <id> --reason "..."
agentxchain reject-turn --turn <id> --reassign
agentxchain approve-transition
agentxchain approve-completion
agentxchain dashboard
agentxchain plugin list
agentxchain plugin install ./my-plugin
```

### Runtime support today

- `manual` is working
- `local_cli` is working
- `api_proxy` is implemented for synchronous review-only turns and stages a provider-backed result during `step`

## Example Governed Lifecycle

```bash
agentxchain init --governed -y

# planning
agentxchain step --role pm
agentxchain accept-turn
agentxchain approve-transition

# implementation
agentxchain step --role dev

# qa
agentxchain step --role qa
agentxchain approve-completion
```

Depending on gate configuration, some phase changes and run completion can auto-advance without a human approval step.

## Legacy v3 Compatibility

Legacy IDE-window coordination is still available for teams that want lock-based handoff in Cursor, VS Code, or Claude Code. It is not the primary product story and is retained for compatibility.

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

Use this mode if you specifically want per-agent IDE sessions and lock-file coordination. For new projects, prefer governed mode.

## Command Groups

### Governed run control

- `init --governed`: scaffold a governed project
- `init --governed --template <id>`: scaffold a governed project with project-shape-specific planning artifacts
- `migrate`: convert a legacy v3 project to governed format
- `status`: inspect current run, phase, active turns, blockers, and approval state
- `resume`: initialize or continue a governed run and assign the next turn
- `step`: run one governed turn end to end, or resume a targeted retained turn
- `accept-turn`: accept the staged governed turn result, including targeted `human_merge` resolution
- `reject-turn`: reject the staged result, retry it, or reassign a conflicted turn with conflict context
- `approve-transition`: approve a pending human-gated phase transition
- `approve-completion`: approve a pending human-gated run completion
- `plugin install|list|remove`: manage hook-packaging plugins under `.agentxchain/plugins/`
- `verify protocol`: run the shipped protocol conformance kit against any target implementation
- `validate`: validate governed kickoff wiring, a staged turn result, or both

### Shared project utilities

- `config`: inspect or edit project configuration
- `update`: update the CLI

### Legacy IDE orchestration

- `start`, `kickoff`, `watch`, `supervise`, `claim`, `release`, `rebind`, `generate`, `branch`, `doctor`, `stop`

## How It Works

### Governed mode

1. The orchestrator initializes or resumes a run.
2. It assigns one or more roles for the current phase, subject to `max_concurrent_turns` (default: one).
3. It writes a turn-scoped dispatch bundle for each active turn.
4. The role completes work and emits a structured turn result.
5. The orchestrator validates schema, assignment, artifacts, verification, and protocol compliance.
6. Accepted turns can advance phase, queue drain-time requests, pause for human sign-off, or complete the run.

### Legacy mode

1. Agents run in separate IDE sessions.
2. Coordination happens through `lock.json`, `state.json`, and `TALK.md`.
3. `watch` or `supervise` acts as the referee loop.

## Protocol Conformance

The protocol is only meaningful if implementations can prove they obey it. The repo ships a conformance kit under `.agentxchain-conformance/` and the CLI exposes it directly:

```bash
agentxchain verify protocol --tier 3 --target .
```

Use `--surface <name>` to isolate one area such as `state_machine`, `dispatch_manifest`, or `coordinator`. Use `--format json` in CI.

## Examples

| Example | What it shows |
|---|---|
| [governed-todo-app](examples/governed-todo-app/) | Governed happy-path example using manual PM, local_cli dev, and api_proxy QA |

## Positioning

AgentXchain is not an MCP replacement and not an agent-to-agent network protocol.

| | MCP | A2A | AgentXchain |
|---|---|---|---|
| Primary unit | tools/data access | networked agents | governed repo workflow |
| Core control model | one agent uses tools | agents message each other | orchestrator assigns the next turn |
| Best fit | tool calling | cross-service delegation | PM, dev, QA convergence on one codebase |

It is also not a drop-in replacement for CrewAI, AG2/AutoGen, LangGraph, the OpenAI Agents SDK, or Semantic Kernel. Those systems help you construct or orchestrate agents. AgentXchain governs how agent work converges on a single codebase with mandatory challenge, explicit human gates, and append-only delivery history.

## Links

- [Website](https://agentxchain.dev)
- [Quickstart](https://agentxchain.dev/docs/quickstart/)
- [CLI reference](https://agentxchain.dev/docs/cli/)
- [Adapter reference](https://agentxchain.dev/docs/adapters/)
- [Protocol spec (v6)](https://agentxchain.dev/docs/protocol/)
- [npm package](https://www.npmjs.com/package/agentxchain)
- [Legacy Protocol v3 spec](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)
- [AgentXchain.ai (commercial cloud)](https://agentxchain.ai)

## License

MIT
