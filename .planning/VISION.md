# AgentXchain — Vision

> Constitutional governance for AI software teams.  
> Long-horizon coding. Governed convergence. Lights-out software factories.

## The Problem

AI labs are optimizing individual model capability. That matters, but it does not solve the harder problem: **how multiple AI agents reliably build software together over long horizons.**

Put several strong agents on one codebase and the failure modes are immediate:

- duplicated work
- contradictory architecture
- shallow self-review
- missing provenance
- no clear authority
- no trustworthy ship decision

The bottleneck is not raw intelligence. The bottleneck is **coordination with governance**.

AgentXchain exists to solve that.

## The Thesis

Long-horizon coding is not mainly a context-window problem. It is a coordination problem.

Building software over hours, days, or weeks requires different roles, different incentives, and different checks:

- planning
- implementation
- review
- QA
- release

No single agent should be trusted to scope, build, approve, and ship its own work. A system that can run a dark or lights-out software factory needs:

- explicit roles and mandates
- structured handoffs
- mandatory challenge
- evidence-backed quality gates
- persistent state and audit history
- human authority at constitutional checkpoints

AgentXchain is that coordination layer.

## The Governed Delivery Loop: Diverge, Challenge, Concur

Every phase in AgentXchain follows a three-beat rhythm:

**Diverge.** Each agent works from a distinct mandate — PM, Dev, QA, Eng Director — producing independent output shaped by its role's perspective and incentives. The PM optimizes for scope and user value. The Dev optimizes for feasibility and technical quality. The QA optimizes for correctness and evidence. These perspectives are *supposed* to conflict. That is the point.

**Challenge.** Every turn must surface at least one objection, risk, or gap in the previous agent's work. This is not politeness. It is a protocol rule — blind agreement is a validation failure the runner rejects. The PM challenges testability. The Dev challenges scope ambiguity. The QA challenges implementation shortcuts. Each agent stress-tests the others from the angle only its mandate can see.

**Concur.** After divergence and challenge, the protocol drives toward a single accepted state. Structured acceptance, rejection, re-work, and human gates force the team to resolve disagreements rather than paper over them. Concurrence is not consensus — it is the point where the evidence satisfies the exit criteria and the governing authority (human or gate) accepts the result.

This loop repeats per phase — planning, implementation, QA — and across phases until the run meets its completion criteria. The quality of the final output is a direct function of how honestly the agents diverged, how rigorously they challenged, and how cleanly they concurred.

## What AgentXchain Is

AgentXchain is a governed multi-agent software delivery system built from five layers:

### 1. Protocol

The durable governance layer.

It defines:

- config and state model
- turn-result schema
- validation rules
- phase gates
- decision ledger
- recovery and escalation semantics

This is the most durable layer and should eventually be implementable by third parties.

### 2. Runners

The enforcement engines.

A runner:

- reads project config
- manages run state
- assigns turns
- validates results
- enforces gates
- handles retries, rejection, recovery, and completion

Today this is primarily a CLI. Over time it can also be a cloud service, CI runtime, IDE-hosted surface, or other execution environment.

### 3. Connectors

The bridges to actual coding agents and model runtimes.

AgentXchain should govern work across:

- local agents
- cloud agents
- API-backed agents
- future agents not yet dominant

Examples include:

- Claude Code
- Codex
- Qwen-Coder
- DeepSeek-Coder
- Gemini
- Aider

The goal is not vendor loyalty. The goal is a stable governance layer that can survive model churn.

### 4. Integrations

The surfaces where people and agents interact with governed runs.

Examples:

- VS Code
- Cursor
- Codex
- Claude Code terminal
- OpenCode

These integrations are not the source of truth. They are views and control surfaces over runner-owned state.

### 5. Opinionated Workflows

Strong defaults for how governed work should happen. A protocol without opinions is a blank page. AgentXchain ships with a real operating model.

#### Planning — Get Shit Done (GSD)

Not 50-page PRDs. Not feature-list brainstorming. GSD planning is scope-first, time-boxed, outcome-oriented:

- what we are building (acceptance criteria, not feature lists)
- what we are not building (explicit scope cuts)
- how we know it is done (measurable exit criteria)
- what could go wrong (risks, dependencies, blockers)

The PM agent's job is to produce a spec that a dev agent can execute against and a QA agent can write tests against. If the spec is ambiguous, the governed workflow catches it — because dev and QA are required to challenge it.

#### Quality — Fast Tests + E2E + TDD

QA is not a rubber-stamp phase. It is a first-class governed gate with teeth.

- **Test-first**: QA defines acceptance tests before or alongside implementation, not after
- **Fast-feedback test runner**: use the fastest credible runner for the repo, with a bias toward Vitest-style feedback loops where appropriate
- **E2E as the quality bar**: unit tests are necessary but not sufficient. Governed QA requires end-to-end proof that the system works as specified
- **Verification evidence in turn results**: test command, exit code, pass/fail counts — structured data, not prose claims
- **Mandatory challenge**: QA must surface at least one risk or gap per turn. Blind approval is a protocol violation

The QA agent's job is to block shipping until the evidence says ship.

#### Documentation — Repo-Native Living Docs

Code without documentation is a liability that compounds with every agent turn.

- `TALK.md` — human-readable collaboration log across turns
- decision ledger — append-only JSONL of every significant decision
- `.planning/` artifacts — roadmap, acceptance matrix, sign-offs, ship verdict
- architecture docs — non-obvious decisions documented in-repo by agents
- README as front door — reflects what was built, not what was planned

Documentation is a continuous output of the governed workflow, not a post-ship chore.

These workflows are defaults, not a religion. Teams can override them. But new projects should get a working multi-agent pipeline out of the box.

## Core Operating Beliefs

### Governance beats orchestration theater

The problem is not “how do agents message each other more?”

The problem is:

- who is allowed to act
- what they must produce
- who challenges them
- what evidence is required
- who can advance the phase
- who can ship

AgentXchain governs those questions directly.

### Adversarial collaboration beats polite delegation

The system should not reward agents for agreeable summaries. It should reward them for surfacing scope errors, implementation flaws, testing gaps, and release risk.

Important roles should have distinct mandates:

- PM defends scope, value, and sequencing
- Dev defends feasibility and technical quality
- QA defends correctness and evidence
- architectural or coordinating roles defend coherence and release safety

Mandatory challenge is not optional style. It is part of robustness.

### The protocol is the product

Models, IDEs, and runtimes will change constantly.

What must remain stable is the governed workflow:

- turn assignment
- structured outputs
- validation
- gates
- history
- recovery

That is the product core.

### Human authority should be constitutional, not constant

Humans should not approve every small step. That destroys autonomy.

Humans should retain authority over:

- scope approval
- key phase transitions
- escalation and conflict resolution
- ship decisions
- exceptional recovery

The goal is not “remove humans.” The goal is “place humans where authority matters most.”

### Convergence quality matters more than raw generation speed

Fast wrong code is expensive.

AgentXchain optimizes for:

- better planning
- better disagreement
- better evidence
- better ship decisions
- higher-confidence convergence over long horizons

## What We Are Building Toward

The end state is not just “multi-agent coding.”

The end state is **long-horizon autonomous software delivery**: systems where a human provides mission, constraints, and approval boundaries, and governed AI teams can plan, build, challenge, test, document, and prepare software for shipping over sustained horizons.

That is what makes dark or lights-out software factories viable.

To get there, AgentXchain must make it possible to:

- translate broad goals into governed slices
- let PM-like agents produce usable specs
- require Dev and QA agents to challenge those specs
- preserve state and context across long runs
- recover from blocked or failed turns
- prove quality before release actions
- keep humans at the constitutional layer, not in every loop

## What This Is Not

AgentXchain is not:

- just another agent framework
- just a prompt pack
- just an IDE plugin
- just MCP or A2A wiring
- just CI/CD
- just a swarm of agents talking

It is the governance and workflow layer above those pieces.

## The Product Split: `.dev` vs `.ai`

This distinction must stay explicit.

### `agentXchain.dev`

Open-source core.

It is the developer-first system:

- protocol
- local runner(s)
- CLI
- connectors
- specs
- templates
- repo-native workflows
- examples
- self-hostable governed execution

It is where the core coordination model is defined, proven, and adopted.

### `agentXchain.ai`

Commercial managed product.

It is the cloud and application layer built on top of the `.dev` core:

- hosted orchestration
- dashboards
- team and org management
- managed history and compliance surfaces
- cloud execution
- installable apps and integrations
- enterprise controls and visibility

If `.dev` is the open protocol and self-hosted engine, `.ai` is the managed experience and distribution layer.

### Simple rule

- `.dev` makes AgentXchain usable by engineers and contributors
- `.ai` makes AgentXchain adoptable by broader teams and organizations

Same underlying coordination model. Different product surfaces and business model.

## Business Direction

Open core is strategic, not charitable.

The protocol, core runner, and developer workflows should remain open because adoption is the moat. If AgentXchain becomes the default governance layer for multi-agent software delivery, the managed cloud product becomes much easier to sell.

The business is not “own one model.”  
The business is “own the governed workflow that every serious AI software team needs.”

## Why This Should Exist

AI-generated software is increasing quickly. The missing piece is not more generation. It is trust.

Organizations will increasingly ask:

- what did the agents do
- why did they do it
- who challenged it
- what evidence exists
- who approved shipping
- how do we recover when something goes wrong

AgentXchain is the bet that the answer will not be “just trust the model.”

The answer will be governed multi-agent delivery with auditability, challenge, gates, and constitutional human authority.

That is the product.
