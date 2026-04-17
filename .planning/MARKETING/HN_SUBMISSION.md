# Hacker News Submission — AgentXchain v2.127.0

> Ready-to-post. Updated 2026-04-17 for v2.127.0.

---

## Show HN Submission

**Title:** Show HN: AgentXchain – Open-source protocol where AI agents must challenge each other before code ships

**URL:** https://agentxchain.dev

**Comment (post immediately after submission):**

Hi HN, I've been building AgentXchain — an open-source governance protocol for multi-agent software delivery.

The problem: when you let multiple AI agents work on the same codebase, they tend to agree with each other, quality drifts, nobody owns decisions, and there's no way to tell what's actually shippable.

AgentXchain fixes this by treating multi-agent delivery as a governed system:

- Every agent turn MUST include at least one objection about the prior agent's work. Blind agreement is rejected.
- Humans approve phase transitions (planning -> implementation -> QA) and the ship decision.
- Phase gates enforce that real artifacts exist before work advances.
- Every decision goes into an append-only audit ledger.
- Works with any model or runtime: Claude Code, Cursor, direct API calls, MCP servers, or manual human turns.

The design borrows from institutional governance: the quality of collective output depends on the structure of disagreement, not the intelligence of participants.

**30-second demo (no API keys needed):**

```
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

This runs a complete governed lifecycle: PM scopes a feature, raises a risk. Dev implements and resolves the risk, raises a new one. QA reviews against acceptance criteria and raises a compliance gap. Three different perspectives, three different failure classes caught.

**What's shipped in v2.127.0:**
- Governed `run` now enforces the existing turn-timeout contract during in-flight adapter dispatch instead of hanging indefinitely on a stuck automated turn
- `status`, `turn show`, and dashboard timeout surfaces now show remaining budget and deadline, not just elapsed time
- All 5 adapters proven live (manual, local CLI, API proxy, MCP, remote_agent)
- `local_cli`, `api_proxy`, `mcp`, and `remote_agent` proven with real AI models; `manual` is the human-in-the-loop control path
- Escalation and recovery: retry exhaustion -> blocked state -> operator recovery, proven through the real CLI
- Proposal authoring: agents propose changes through a staging area with conflict detection
- 5,586 tests / 1,170 suites / 0 failures. 108 conformance fixtures. Website build clean.
- Post-release `npx` install verification as part of the release process

**Architecture:**
1. Protocol (the constitution — run state, roles, turns, gates, decisions)
2. Runners (enforcement engines — CLI is the reference implementation)
3. Connectors (bridges to agent runtimes)
4. Workflow Kit (opinionated operating model for planning/specs/QA/release)
5. Integrations (dashboard, notifications, plugins, multi-repo)

MIT licensed. Protocol is the product. The CLI is one implementation.

- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain
- Website: https://agentxchain.dev
- Docs: https://agentxchain.dev/docs/quickstart

Happy to answer questions about the architecture, the mandatory challenge design, or the evidence approach.

---

## Posting Instructions

1. Submit as "Show HN" with `https://agentxchain.dev`
2. Post the comment immediately after submission
3. Best times: Tuesday-Thursday, 10-11am ET
4. Be available to respond for at least 3 hours after posting
5. Expected questions to prepare for:
   - "How is this different from CrewAI/LangGraph?" → Those build agents. AgentXchain governs how they converge.
   - "Why not just use code review?" → Code review is post-hoc. Governed turns enforce challenge at every step.
   - "Does mandatory challenge slow things down?" → The demo runs in 1.8s. The overhead is structural, not temporal.
   - "What models does it work with?" → Any model. Protocol is model-agnostic. Proven with Claude, works with any LLM API.
   - "How does this compare to A2A?" → A2A is agent-to-agent messaging. AgentXchain governs the delivery process.
   - "`npx --yes -p agentxchain@latest -c "agentxchain demo"` says `unknown command 'demo'`" → This is usually npm resolving a stale global install first. Use `npx -p agentxchain@latest -c 'agentxchain demo'`.
