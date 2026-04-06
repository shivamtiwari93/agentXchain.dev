# Reddit Posts — AgentXchain v2.11.0

> Ready-to-post content for Reddit. Post after npm publish is live.
> Updated 2026-04-04 from v2.10.0 to reflect v2.11.0 shipped reality.

---

## r/programming

**Title:** Show r/programming: AgentXchain – open-source protocol where AI agents are required to challenge each other before code can ship

**Body:**

I built an open-source governance protocol for multi-agent software delivery. The core idea: instead of one AI agent writing code unchecked, multiple agents with different mandates (PM, Dev, QA) work in structured turns and are **required to challenge each other's work**. Blind agreement is rejected by the orchestrator.

**What it does:**

- Structured turn-based workflow with mandatory objections
- Human approval required at phase transitions and ship decisions
- Append-only audit trail (decisions, objections, risks, verification evidence)
- Continuous delivery intake: repo-native trigger detection, triage, approval, planning, scan, resolve lifecycle
- Multi-repo coordination across multiple repositories
- Plugin system for Slack notifications, JSON reporting, custom validators
- Model-agnostic: works with Claude Code, Codex, Aider, or any LLM API
- 77 conformance fixtures so third-party implementations can prove protocol compliance
- Workflow-kit proof: `template validate` proves the governed scaffold contract with structural markers

**What it is NOT:**

- Not an agent framework (that's CrewAI, LangGraph, AutoGen)
- Not a CI/CD pipeline
- Not a chat interface

The protocol is the product. The CLI is one implementation. 2,500+ tests. MIT licensed.

- Website: https://agentxchain.dev
- Release notes: https://agentxchain.dev/docs/releases/v2-11-0
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: `npx agentxchain init --governed`

Happy to answer questions about the architecture or the "mandatory challenge" design.

**URL:** https://reddit.com/r/programming/submit

---

## r/artificial

**Title:** AgentXchain v2.11 – governance protocol for multi-agent software teams (mandatory challenge, human gates, audit trail)

**Body:**

When multiple AI agents work on the same codebase, the bottleneck isn't intelligence — it's coordination. AgentXchain is an open-source protocol that governs how agents collaborate:

- Every turn must include at least one objection about the prior agent's work
- Humans approve phase transitions and the final ship decision
- Every decision is recorded in an append-only ledger
- Continuous delivery intake: automated trigger detection, triage, approval, and governed execution
- Multi-repo coordination, a local dashboard, and a plugin system
- 77 conformance fixtures for third-party protocol implementors
- Workflow-kit proof: `template validate` proves scaffold contract with structural markers

The design borrows from institutional governance: the quality of collective output depends on the structure of disagreement, not the intelligence of participants.

MIT licensed. 2,500+ tests. Protocol v6 spec published.

https://agentxchain.dev | https://agentxchain.dev/docs/releases/v2-11-0 | https://github.com/shivamtiwari93/agentXchain.dev

**URL:** https://reddit.com/r/artificial/submit

---

## r/LocalLLaMA

**Title:** AgentXchain – open protocol for governing multi-agent coding workflows (works with any model)

**Body:**

If you're running local models for coding, you've probably noticed that multi-agent setups where agents just agree with each other produce worse output than a single focused agent. AgentXchain fixes this with a governance protocol:

- Mandatory challenge: every turn must object to something from the prior turn
- Phase gates: human approves planning → implementation → review transitions
- Any model works: the protocol is runtime-agnostic. Local models via API proxy, Claude Code, Codex, or manual turns all participate under the same rules
- Continuous delivery intake pipeline for automated trigger detection and governed execution

The insight: structured disagreement between agents produces better convergence than cooperative delegation from one "manager" agent.

MIT licensed. 2,500+ tests. https://github.com/shivamtiwari93/agentXchain.dev

**URL:** https://reddit.com/r/LocalLLaMA/submit

---

## Posting Instructions

1. `npm install agentxchain@2.11.0` is live on npm — ready to post
2. Post during US morning hours (10-11am ET, Mon-Thu)
3. Post to r/programming first, then r/artificial and r/LocalLLaMA 30-60 minutes later
4. Be in all threads for the first 2 hours to answer questions
5. Do NOT use the word "constitutional" in the title — it sounds academic. Save it for deep architectural questions.
