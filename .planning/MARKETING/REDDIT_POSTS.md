# Reddit Posts — AgentXchain v2.154.0

> Ready-to-post content for Reddit for the `v2.154.0` release once tester verification lands. Updated 2026-04-22 for the BUG-62 operator-commit reconcile release over `v2.153.0` (manual `reconcile-state --accept-operator-head`, continuous `reconcile_operator_commits`, safe fast-forward acceptance, governed-state and history-rewrite refusals).
> All five adapter types proven live. Four non-manual adapter types have real-model proof. Full evidence surface at agentxchain.dev.
>
> Aggregate evidence:
> - node --test cli/test/beta-tester-scenarios/ cli/test/claim-reality-preflight.test.js -> 233 tests / 69 suites / 0 failures / 5 skipped

---

## r/programming

**Title:** Show r/programming: AgentXchain – open-source protocol where AI agents must challenge each other before code ships

**Body:**

I've been building an open-source governance protocol for multi-agent software delivery. The problem: when you let multiple AI agents work on the same codebase, they agree with each other, quality drifts, nobody owns decisions, and you can't tell what's shippable. Sound familiar?

AgentXchain fixes this with a constitutional governance layer:

**Core rules:**
- Every agent turn MUST include at least one objection about the prior agent's work. Blind agreement is a protocol violation.
- Humans approve phase transitions (planning -> implementation -> QA) and the final ship decision.
- Every decision goes into an append-only audit ledger.
- Phase gates enforce that real artifacts exist before work advances.

**What's in the box (v2.149.1):**
- 5 adapter types: manual (human-in-the-loop), local_cli (Claude Code, Cursor, any CLI agent), api_proxy (direct LLM API), MCP (stdio + streamable HTTP), remote_agent (HTTP bridge)
- All 5 adapters proven live
- `local_cli`, `api_proxy`, `mcp`, and `remote_agent` proven with real AI models (Claude, not mocks); `manual` is the human control path
- 108 conformance fixtures across 13 protocol surfaces
- Escalation and recovery: retry exhaustion -> blocked state -> operator recovery -> director review. Proven through the real CLI.
- Proposal authoring: `api_proxy` agents propose file changes that go through `proposal apply` before touching the workspace
- Multi-repo coordination across repositories
- Plugin system, real-time dashboard, webhook notifications
- BUG-54 auth-preflight fix shipped: Claude `local_cli` runtimes now fail before spawn when neither env auth nor `--bare` is present, using the same `claude_auth_preflight_failed` signal across adapter dispatch, `connector check`, and `connector validate`
- BUG-54 diagnostics + runbook still ship: `process_exit` forensic fields, reproduction harness, tester runbook, and per-runtime watchdog override
- BUG-55 sub-A checkpoint completeness refined: declared `files_changed` partitioned into `staged` / `already_committed_upstream` / `genuinely_missing` so the dirty-survival gate holds while legitimate BUG-23 pre-commit patterns stop false-positiving
- BUG-55 sub-B `undeclared_verification_outputs` error class shipped: acceptance rejects turns whose declared verification produced undeclared fixture outputs, with a remediation pointer to `verification.produced_files`
- BUG-54, BUG-52, BUG-55, and BUG-53 remain open pending tester verification on `v2.149.1`
- node --test cli/test/beta-tester-scenarios/ → 172 tests / 64 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 42 tests / 1 suite / 0 failures

**See it in 30 seconds (no API keys needed):**

```
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

This runs a complete governed lifecycle: PM scopes auth-token rotation, raises a missing-rollback objection. Dev implements and resolves the objection, raises a clock-skew risk. QA reviews against the acceptance matrix, raises a compliance gap. Three different failure classes caught by three different perspectives. 1.8 seconds. Zero API keys.

**What it is NOT:**
- Not an agent framework (that's CrewAI, LangGraph, AutoGen)
- Not a single-agent coding assistant (that's Devin, Cursor, Copilot)
- Not a message router (that's A2A)
- Not a tool connector (that's MCP)

It's the governance layer between agents. They can be built with anything. We govern how they converge.

MIT licensed. Protocol is the product. CLI is one implementation.

- Website: https://agentxchain.dev
- Demo: `npx --yes -p agentxchain@latest -c "agentxchain demo"`
- Quickstart: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

Happy to answer questions about the architecture, the "mandatory challenge" design, or how we proved all five adapter types live without collapsing the human control path into fake real-model proof.

**URL:** https://reddit.com/r/programming/submit

---

## r/artificial

**Title:** AgentXchain v2.149.1 – Claude auth preflight, reconciler proof, and checkpoint hardening

**Body:**

When multiple AI agents work on the same codebase, the bottleneck isn't intelligence — it's coordination. Work overlaps. Assumptions diverge. Quality drifts. Nobody owns the decision trail.

AgentXchain is an open-source protocol that governs how agents collaborate:

- Every turn must include at least one objection about the prior agent's work
- Humans approve phase transitions and the final ship decision
- Every decision is recorded in an append-only ledger
- Phase gates enforce that real artifacts exist before work advances
- 5 runtime adapters: manual, local CLI, API proxy, MCP, remote_agent — all proven live
- `local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof; `manual` is the governed human path
- 108 conformance fixtures across 13 protocol surfaces
- Escalation and recovery protocols for when agents fail or get stuck
- Proposal authoring: agents propose changes through a staging area with conflict detection
- Multi-repo coordination, plugin system, real-time dashboard
- Next release slice carries BUG-54 Claude auth preflight across adapter/check/validate, plus the existing diagnostics/runbook, BUG-52 four-lane reconciler proof, BUG-55 checkpoint/verification hardening, and BUG-53 continuous auto-chain proof for tester verification.
- node --test cli/test/beta-tester-scenarios/ → 172 tests / 64 suites / 0 failures

The design borrows from institutional governance: the quality of collective output depends on the structure of disagreement, not the intelligence of participants.

**See it instantly:**
```
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

- node --test cli/test/beta-tester-scenarios/ → 172 tests / 64 suites / 0 failures

https://agentxchain.dev | https://github.com/shivamtiwari93/agentXchain.dev

**URL:** https://reddit.com/r/artificial/submit

---

## r/LocalLLaMA

**Title:** AgentXchain – open protocol for governing multi-agent coding workflows (works with any model, any runtime)

**Body:**

If you're running local models for coding, you've probably noticed that multi-agent setups where agents just agree with each other produce worse output than a single focused agent. AgentXchain fixes this with a governance protocol:

- Mandatory challenge: every turn must object to something from the prior turn
- Phase gates: human approves planning -> implementation -> review transitions
- Any model works: local models via API proxy, Claude Code, Cursor, Codex, remote agents, or manual turns — all under the same governance rules
- MCP adapter: any MCP-compatible tool server can participate as a governed agent
- Proposal authoring: agents propose file changes through a staging workflow instead of writing directly to the workspace

The protocol doesn't care what model you use. It governs the coordination between agents.

**Quick demo (no API keys):**
```
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

- 172 tests / 64 suites / 0 failures in the current beta-tester release lane

**URL:** https://reddit.com/r/LocalLLaMA/submit

---

## r/ChatGPT

**Title:** Built an open-source protocol where AI agents are required to disagree with each other before code can ship

**Body:**

Most multi-agent AI demos show agents cooperating smoothly. The problem: they're just agreeing with each other, which produces the same failure modes as a single agent.

AgentXchain is an open-source governance protocol where:
- Every agent turn MUST challenge the prior agent's work
- Humans approve phase transitions and ship decisions
- Every decision is auditable in an append-only ledger
- Works with any model (Claude, GPT, local models, MCP servers)

Try it in 30 seconds: `npx --yes -p agentxchain@latest -c "agentxchain demo"`

No API keys needed. Watch three agents (PM, Dev, QA) work through auth-token rotation with mandatory objections.

MIT licensed. https://agentxchain.dev

**URL:** https://reddit.com/r/ChatGPT/submit

---

## Posting Instructions

1. `npm install agentxchain@latest` is live on npm — ready to post
2. Post during US morning hours (10-11am ET, Mon-Thu)
3. Post to r/programming first (highest signal), then r/artificial and r/LocalLLaMA 30-60 minutes later, then r/ChatGPT
4. Lead with the demo: `npx --yes -p agentxchain@latest -c "agentxchain demo"` — this is the strongest hook because it works instantly with zero setup
5. If someone hits `unknown command 'demo'`, reply with `npx --yes -p agentxchain@latest -c "agentxchain demo"` and explain that npm can resolve a stale global install first
6. Be in all threads for the first 2 hours to answer questions
7. Do NOT use the word "constitutional" in the title — it sounds academic
8. If asked "how is this different from CrewAI/LangGraph": AgentXchain governs the delivery process, not the agent construction. Those frameworks build agents. AgentXchain governs how they converge.
