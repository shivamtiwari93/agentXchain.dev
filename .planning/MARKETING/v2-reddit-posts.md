# v2.0.1 Reddit Posts

**Human task: post to the subreddits below.** Copy is ready to paste.

---

## r/programming

**Title:** AgentXchain v2: Constitutional governance for multi-agent software delivery (open source)

**Body:**

We've been building a governance layer for AI agents that write code together. Not another agent framework — a coordination protocol with real enforcement.

The problem: put multiple AI agents on one codebase and you get merge conflicts, duplicated work, contradictory architecture, and no audit trail. Individual models are capable. Coordination is the bottleneck.

AgentXchain governs multi-agent delivery:

- **Roles with mandates** — PM, Dev, QA agents have distinct responsibilities and must challenge each other
- **Structured gates** — phase transitions require evidence, not prose claims
- **Multi-repo orchestration** (new in v2) — coordinate governed agents across multiple repos with cross-repo context injection
- **Plugin system** — extend with hooks (Slack notifications, JSON reports, custom)
- **Protocol spec** — constitutional document that third-party orchestrators can implement

Works with Claude Code, Codex, Gemini, or any agent. Open source (MIT).

- npm: `npm install -g agentxchain`
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- 952 tests, 0 failures

Would love feedback from anyone running multi-agent coding setups.

---

## r/LocalLLaMA

**Title:** Open-source governance layer for multi-agent coding — works with any model/agent

**Body:**

AgentXchain is a governance and coordination layer for AI agents writing code together. Just shipped v2 with multi-repo orchestration.

Why this matters for local LLM users: AgentXchain is model-agnostic. It doesn't care if you're running Claude, GPT, Codex, Qwen-Coder, DeepSeek-Coder, or a local model. It governs the *workflow* — turn assignment, structured outputs, validation, quality gates, decision ledger — not the model.

v2 features:
- Multi-repo orchestration with cross-repo context
- Plugin system (Slack, JSON reports, custom hooks)
- 7-panel local dashboard
- Protocol v6 spec for multi-repo governance
- SDLC templates (API service, CLI tool, web app)

The thesis: the bottleneck isn't model intelligence. It's coordination. Better planning, better disagreement, better evidence, better ship decisions.

MIT licensed. `npm install -g agentxchain`

GitHub: https://github.com/shivamtiwari93/agentXchain.dev

---

## r/artificial

**Title:** AgentXchain: What if AI coding teams had constitutional governance?

**Body:**

We're building governance infrastructure for multi-agent software delivery. The core idea: when multiple AI agents collaborate on code, the missing piece isn't smarter models — it's coordination with accountability.

AgentXchain enforces:
- Explicit roles (PM, Dev, QA) with distinct mandates
- Mandatory challenge — blind agreement is a protocol violation
- Evidence-based quality gates
- Audit history for every decision
- Human authority at constitutional checkpoints

Just shipped v2 with multi-repo orchestration, a plugin system, and Protocol v6 (the constitutional spec).

Open source, model-agnostic (works with any agent/LLM). The bet: as AI-generated code increases, organizations will demand governed multi-agent delivery with auditability — not "just trust the model."

GitHub: https://github.com/shivamtiwari93/agentXchain.dev
