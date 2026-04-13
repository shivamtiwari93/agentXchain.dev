# AgentXchain.dev

Governed multi-agent software delivery for long-horizon coding, with single-repo workflows by default and multi-repo coordination in v2.

AgentXchain runs sequential turns by default and can optionally run parallel governed turns, always requiring a structured turn result, validating artifacts and verification claims, enforcing phase gates, and keeping a human-readable collaboration log alongside append-only machine history.

The product is the protocol and runner. Agents are required to challenge each other, humans retain authority at phase and ship gates, and every turn leaves an audit trail. AgentXchain.dev is the open-source surface for the protocol, connectors, workflows, and implementation evidence; AgentXchain.ai is the managed cloud surface for teams that want hosted infrastructure and integrations.

## Try It Now

See governance before you wire a real repo:

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

Requires Node.js 18.17+ or 20.5+ and `git`. The demo creates a temporary governed repo, runs a full PM -> Dev -> QA lifecycle through the real runner interface, shows gates/decisions/objections, and cleans up afterward. No API keys, config edits, or manual turn authoring required.

If you want your own governed project after that, install the CLI once, then jump to [Quick Start](#quick-start) and scaffold with `agentxchain init --governed --goal "Your project mission"` before running `agentxchain doctor`.

## What It Does

- Drives multi-turn governed execution to completion via `agentxchain run`
- Requires a structured turn result for every governed turn
- Enforces mandatory challenge, phase gates, and human approvals
- Records accepted history in append-only JSONL plus `TALK.md`
- Surfaces checkpointed continuity in `agentxchain status` and rebuilds lost session context with `agentxchain restart`
- Supports cross-machine continuity via `agentxchain export` + `agentxchain restore` for same-repo, same-commit checkouts
- Supports `manual`, `local_cli`, `api_proxy`, and `mcp` runtimes under the same workflow
- Runs sequentially by default, with optional parallel governed turns up to the configured cap
- Adds multi-repo coordinator flow with `agentxchain multi step`, `agentxchain multi resume`, `agentxchain multi approve-gate`, cross-repo context, and coordinator hooks
- Adds continuous-delivery intake (`intake record`, `triage`, `approve`, `plan`, `start`, `scan`, `resolve`) for turning delivery signals into governed work
- Bridges repo-local intake to multi-repo coordinator workstreams via `intake handoff`
- Adds repo-local lights-out scheduling with `schedule list`, `schedule run-due`, `schedule daemon`, and `schedule status`
- Adds governed plugin install/list/remove commands for packaging hook integrations without forking core config

## Architecture

AgentXchain is organized in five layers:

| Layer | What it does |
|-------|-------------|
| **Protocol** | Turn-scoped dispatch, structured results, validation, append-only history, decision ledger, phase gates, recovery rules |
| **Runners** | Execution engines that apply the protocol — local CLI runner, CI runners, future hosted runner |
| **Connectors** | Bridges to agent runtimes — local coding agents, cloud AI, model APIs, IDE surfaces (VS Code, Cursor, Claude Code) |
| **Workflow Kit** | Opinionated operating model for planning, specs, implementation, QA, release, escalation, and recovery |
| **Integrations** | Dashboards, notifications, ticketing, compliance hooks, and release surfaces |

The protocol is the durable layer. Runners enforce it. Connectors bridge to agents. The workflow kit makes it opinionated. Integrations connect it to your organization.

## Docs

- [Getting Started](https://agentxchain.dev/docs/getting-started/)
- [Quickstart](https://agentxchain.dev/docs/quickstart/)
- [CLI reference](https://agentxchain.dev/docs/cli/)
- [Lights-Out Scheduling](https://agentxchain.dev/docs/lights-out-scheduling/)
- [Templates](https://agentxchain.dev/docs/templates/)
- [Export schema reference](https://agentxchain.dev/docs/export-schema/)
- [Multi-session continuity](https://agentxchain.dev/docs/multi-session/)
- [Adapter reference](https://agentxchain.dev/docs/adapters/)
- [Protocol spec (v6)](https://agentxchain.dev/docs/protocol/)
- [Protocol reference](https://agentxchain.dev/docs/protocol-reference/)
- [Build your own runner](https://agentxchain.dev/docs/build-your-own-runner/)
- [Why governed multi-agent delivery matters](https://agentxchain.dev/why/)

## Install

```bash
npm install -g agentxchain
agentxchain --version
```

Or via Homebrew (macOS/Linux):

```bash
brew tap shivamtiwari93/tap
brew install agentxchain
```

For a zero-install one-off:

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

Requires Node.js 18.17+ or 20.5+.

## Testing

The CLI now ships a 36-file Vitest coexistence slice alongside the existing `node --test` suite.

```bash
cd cli
npm run test:vitest
npm run test:node
npm test
```

- `npm run test:vitest`: fast-feedback Vitest slice for the current 36 covered files
- `npm run test:node`: full authoritative suite, including integration, subprocess, and E2E coverage
- `npm test`: runs both sequentially and is the CI contract right now

Duplicate execution remains intentional for the current 36-file slice while the migration is still proving runner agreement on deeper stateful tests. For local watch mode, use `cd cli && npx vitest`.

## Quick Start

### New governed project

```bash
agentxchain init --governed --goal "Build an expense tracker with team splitting" --dir my-agentxchain-project -y
cd my-agentxchain-project
git init
agentxchain template validate
agentxchain doctor
agentxchain connector check
git add -A
git commit -m "initial governed scaffold"
agentxchain status
agentxchain step --role pm
```

If you skipped `--goal` during scaffold, run `agentxchain config --set project.goal "Build an expense tracker with team splitting"` before the first governed turn so agents receive mission context in every dispatch bundle.

The default governed dev runtime is `claude --print --dangerously-skip-permissions` with stdin prompt delivery. The non-interactive governed path needs write access, so do not pretend bare `claude --print` is sufficient for unattended implementation turns. If your local coding agent uses a different launch contract, set it at scaffold time instead of patching JSON later:

```bash
agentxchain init --governed --dir my-agentxchain-project --dev-command ./scripts/dev-agent.sh --dev-prompt-transport dispatch_bundle_only -y
```

If you want scaffold intent captured up front, choose a governed template:

```bash
agentxchain init --governed --template web-app --dir my-agentxchain-project -y
```

Built-in governed templates:

- `generic`: baseline governed scaffold
- `api-service`: adds API contract, operational readiness, and error-budget planning files
- `cli-tool`: adds command-surface, platform-support, and distribution planning files
- `library`: adds public-API, compatibility-policy, and release-adoption planning files
- `web-app`: adds user-flow, UI acceptance, and browser-support planning files
- `enterprise-app`: adds enterprise planning artifacts plus blueprint-backed `architect` and `security_reviewer` phases

Inspect the shipped template surfaces instead of guessing:

```bash
agentxchain template list
agentxchain template list --phase-templates
```

`template list` shows governed project templates. `template list --phase-templates` shows the reusable workflow-kit phase-template bundles for `workflow_kit.phases.<phase>.template`. See the [Templates](https://agentxchain.dev/docs/templates/) docs for the full contract and JSON output shape.

`step` writes a turn-scoped dispatch bundle under `.agentxchain/dispatch/turns/<turn_id>/` and tells you where the staged result must be written. For manual turns, fill in `.agentxchain/staging/<turn_id>/turn-result.json`, then accept the turn:

```bash
# optional manual preflight
agentxchain validate --mode turn
agentxchain accept-turn
agentxchain approve-transition
git add -A && git commit -m "orchestrator: accept pm turn"

agentxchain step --role dev
agentxchain step --role qa
# if QA uses api_proxy, inspect the review artifact and confirm the
# QA gate files already contain real content before completion
agentxchain approve-completion
```

Default governed scaffolding configures QA as `api_proxy` with `ANTHROPIC_API_KEY`. In `review_only` mode, that path returns a structured verdict but cannot directly write `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, or `.planning/RELEASE_NOTES.md`. In `proposed` mode, the model returns file proposals that the orchestrator materializes under `.agentxchain/proposed/<turn_id>/` for operator review — `proposal apply` copies them to the workspace. Use a writable or manual QA path if you want QA to edit gate files directly. For a provider-free walkthrough, switch the QA runtime to `manual` before the QA step. If you use a custom local coding CLI, either include `{prompt}` in `--dev-command` for argv delivery or set `--dev-prompt-transport` explicitly at init time.

The governed flow is always: assign, stage a structured result, accept or reject, then satisfy any human gate before the next phase can advance.

### Multi-repo coordination

When one initiative spans multiple governed repos, use the coordinator:

```bash
# Scaffold two child repos
agentxchain init --governed --template api-service --dir repos/backend -y
agentxchain init --governed --template web-app --dir repos/frontend -y

# Create coordinator config
cat > agentxchain-multi.json << 'EOF'
{ "repos": { "backend": { "path": "repos/backend" }, "frontend": { "path": "repos/frontend" } } }
EOF

agentxchain multi init
agentxchain multi step --json
```

Each child repo keeps its own governed state and gates. The coordinator adds cross-repo sequencing, shared barriers, and a coordinator-owned gate. If the coordinator enters `blocked`, fix the cause and run `agentxchain multi resume` before continuing with `multi step` or `multi approve-gate`. See the [multi-repo quickstart](https://agentxchain.dev/docs/quickstart#multi-repo-cold-start) for the full cold-start walkthrough.

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
.planning/SYSTEM_SPEC.md
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

### Lifecycle And Execution

```bash
agentxchain init --governed
agentxchain migrate
agentxchain status
agentxchain demo
agentxchain run                              # multi-turn governed execution to completion
agentxchain run --auto-approve --max-turns 20
agentxchain resume
agentxchain resume --turn <id>
agentxchain step                             # single-turn dispatch (manual workflow)
agentxchain step --resume --turn <id>
agentxchain accept-turn --turn <id> --resolution human_merge
agentxchain reject-turn --turn <id> --reason "..."
agentxchain reject-turn --turn <id> --reassign
agentxchain approve-transition
agentxchain approve-completion
agentxchain dashboard
```

### Proof And Inspection

```bash
agentxchain audit                            # live governance audit report
agentxchain diff <left> <right>              # compare two governed runs
agentxchain report                           # generate governance report
agentxchain events                           # inspect lifecycle event stream
agentxchain history                          # query accepted-turn history
agentxchain role list                        # list configured roles and charters
agentxchain role show <role>                 # inspect a single role's configuration
agentxchain turn show                        # inspect the active turn in detail
agentxchain phase list                       # list configured phases
agentxchain phase show <phase>               # inspect a single phase's configuration
agentxchain gate list                        # list configured gates
agentxchain gate show <gate> --evaluate      # evaluate a gate's pass/fail state
agentxchain doctor                           # governed project health check
agentxchain connector check                  # live health probes for configured connectors
agentxchain verify turn                      # replay staged machine-evidence before acceptance
agentxchain replay turn                      # replay accepted machine-evidence from history
agentxchain verify protocol                  # run the protocol conformance kit
```

### Automation, Plugins, And Continuity

```bash
agentxchain restart                         # rebuild lost session context from .agentxchain/session.json
agentxchain restore --input <path>          # cross-machine continuity from a prior run export
agentxchain template validate                  # prove scaffold + workflow-kit contract
agentxchain template validate --json            # machine-readable proof with workflow_kit block
agentxchain multi resume                        # clear a blocked coordinator after operator recovery
agentxchain plugin list
agentxchain plugin list-available
agentxchain plugin install slack-notify
agentxchain export                           # export run state for cross-machine continuity
```

### `agentxchain run`

Drives a governed run from start to completion. Continuously assigns turns, dispatches to adapters (`local_cli`, `api_proxy`, `mcp`), handles gate approvals, and manages rejection/retry until the run reaches a terminal state (`completed`, `blocked`, or `max_turns_reached`). In non-TTY environments, gates fail closed unless `--auto-approve` is set.

```bash
agentxchain run --auto-approve     # CI / lights-out mode
agentxchain run --dry-run           # print plan without executing
agentxchain run --role dev          # override initial role
agentxchain run --max-turns 10      # safety cap
```

### Runtime support today

- `manual` is working
- `local_cli` is working
- `mcp` is working for stdio tool-contract dispatch
- `api_proxy` is implemented for synchronous `review_only` and `proposed` turns and stages a provider-backed result during `step`

## Example Governed Lifecycle

```bash
agentxchain init --governed --dir my-agentxchain-project -y

# planning
agentxchain step --role pm
# edit .planning/PM_SIGNOFF.md and change Approved: NO -> Approved: YES
# only after human kickoff approval
agentxchain accept-turn
agentxchain approve-transition
git add -A && git commit -m "orchestrator: accept pm turn"

# implementation
agentxchain step --role dev
git add -A && git commit -m "orchestrator: accept dev turn"

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
- `verify turn`: replay a staged turn's declared machine-evidence commands to confirm reproducibility before acceptance
- `replay turn`: replay an accepted turn's machine-evidence commands from history for audit and drift detection
- `verify protocol`: run the shipped protocol conformance kit against any target implementation
- `validate`: validate governed kickoff wiring, a staged turn result, or both

### Continuous-delivery intake

- `intake record`: capture a delivery signal as a repo-native event
- `intake triage`: classify and prioritize an event into an actionable intent
- `intake approve`: authorize work on a triaged intent
- `intake plan`: materialize planning artifacts for an approved intent
- `intake start`: begin repo-local governed execution for a planned intent
- `intake handoff`: bridge a planned intent to a coordinator workstream for multi-repo execution
- `intake scan`: observe repo state against active intents
- `intake resolve`: close an intent based on execution outcome

See [Continuous Delivery Intake](https://agentxchain.dev/docs/continuous-delivery-intake/) for the full lifecycle.

### Repo-local automation

- `schedule list`: inspect configured schedules, due status, and recent run/skip metadata
- `schedule run-due`: evaluate schedules once and run only the ones currently due
- `schedule daemon`: poll locally and launch due governed runs on cadence
- `schedule status`: inspect daemon heartbeat and health from `.agentxchain/schedule-daemon.json`

See [Lights-Out Scheduling](https://agentxchain.dev/docs/lights-out-scheduling/) for the repo-local daemon contract. This is not coordinator-wide or hosted automation.

### Governed inspection and audit

- `audit`: live governance audit report with cost summary, decision history, and artifact inventory
- `diff <left> <right>`: compare two governed runs side by side (phase, decisions, artifacts, timing)
- `report`: generate a governance report for the current run
- `events`: inspect the lifecycle event stream (turns, phases, gates, governance events)
- `history`: query accepted-turn history from append-only JSONL
- `role list`: list all configured roles with their charters, runtimes, and phase assignments
- `role show <role>`: inspect a single role's full configuration
- `turn show`: inspect the active turn in detail (assignment, artifacts, timing, verification)
- `phase list`: list configured phases with gate requirements and advancement rules
- `phase show <phase>`: inspect a single phase's configuration and current state
- `gate list`: list all configured gates with their types and phase boundaries
- `gate show <gate> --evaluate`: evaluate a gate's current pass/fail state against live project state
- `doctor`: governed project health check (config, roles, runtimes, state, schedules, plugins, workflow-kit)
- `connector check`: live health probes for all configured connectors (api_proxy, remote_agent, MCP)
- `export`: export run state for cross-machine continuity via `restore`

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
| [decision-log-linter](examples/decision-log-linter/) | Governed developer-tool example: a real CLI that lints markdown decision logs with explicit workflow-kit, custom architecture phase, and release phase |
| [habit-board](examples/habit-board/) | Governed consumer SaaS example: a habit tracker web app with REST API, streak logic, responsive UI, and a designer-in-the-loop 4-phase workflow |
| [async-standup-bot](examples/async-standup-bot/) | Governed B2B SaaS example: a team standup collector with reminder previews, manager summaries, retention operations, and a 5-phase integration/ops workflow |
| [trail-meals-mobile](examples/trail-meals-mobile/) | Governed mobile app example: a React Native (Expo) hiker meal planner with offline-first AsyncStorage, nutrition math, platform matrix, and a 6-role mobile-specific workflow |
| [schema-guard](examples/schema-guard/) | Governed open-source library example: a composable schema-validation package with path-aware errors, typed exports, API review, and release-engineering workflow |
| [external-runner-starter](examples/external-runner-starter/) | Canonical installed-package starter for external runner authors — `npm install agentxchain` + `import from 'agentxchain/runner-interface'` |
| [ci-runner-proof](examples/ci-runner-proof/) | Repo-native runner proof in 3 tiers: single-turn primitive, full lifecycle, and `runLoop` composition |
| [mcp-echo-agent](examples/mcp-echo-agent/) | Reference MCP stdio server implementing `agentxchain_turn` with a validator-clean no-op result |
| [mcp-http-echo-agent](examples/mcp-http-echo-agent/) | Reference MCP streamable HTTP server for remote `agentxchain_turn` dispatch |
| [remote-conformance-server](examples/remote-conformance-server/) | HTTP fixture server for `agentxchain verify protocol --remote` |
| [live-governed-proof](examples/live-governed-proof/) | Live single-turn governed proof using a real model via `api_proxy` |

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
- [Getting Started](https://agentxchain.dev/docs/getting-started/)
- [Quickstart](https://agentxchain.dev/docs/quickstart/)
- [CLI reference](https://agentxchain.dev/docs/cli/)
- [Adapter reference](https://agentxchain.dev/docs/adapters/)
- [Protocol spec (v6)](https://agentxchain.dev/docs/protocol/)
- [npm package](https://www.npmjs.com/package/agentxchain)
- [Legacy Protocol v3 spec](https://github.com/shivamtiwari93/agentXchain.dev/blob/main/PROTOCOL-v3.md)
- [AgentXchain.ai (commercial cloud)](https://agentxchain.ai)

## License

MIT
