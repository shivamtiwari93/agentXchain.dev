# Show HN Draft — AgentXchain v2.132.0

> Ready-to-post draft. Updated 2026-04-18 for v2.132.0.

---

## Title

Show HN: AgentXchain – Agents required to challenge each other before shipping code

## URL

https://agentxchain.dev

## Text

I got tired of multi-agent coding demos where three agents agree with each other, dump a diff, and nobody can explain why the code should ship. So I built a workflow where **agents are required to challenge each other before the run can advance**.

AgentXchain is an open-source protocol + CLI for governed software delivery:

- **Every turn must include an objection.** Blind agreement is rejected by the orchestrator.
- **The protocol requires human approval for phase transitions and ship decisions.** Agents work between gates, but they cannot self-ship.
- **Structured audit trail.** Summary, objections, decisions, files changed, and verification evidence — all append-only JSONL. Every decision has provenance.
- **Multi-repo orchestration.** v2 coordinates governed workflows across multiple repositories with cross-repo context, barrier evaluation, and coordinator-level hooks.
- **Plugin system.** Install hook-based plugins for notifications (Slack) and reporting (JSON artifacts) without modifying the core workflow.
- **All 5 adapters proven live.** `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent` all run under the same governed protocol. `local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof; `manual` is the governed human control path.
- **108 conformance fixtures** across 13 protocol surfaces.

Fastest proof path:

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

That runs a complete PM -> Dev -> QA governed lifecycle with objections, gates, decisions, and audit artifacts. No API keys required.

If you want the real CLI flow instead of the demo:

```bash
npm install -g agentxchain
agentxchain init --governed
agentxchain step --role pm
agentxchain accept-turn
agentxchain approve-transition
agentxchain step --role dev
```

The point is not “more agents.” The point is better convergence: disagreement by default, explicit gates, and a readable audit trail for how the team reached a ship decision.

Latest shipped operator slice: `v2.132.0` fixes the iterative-planning conflict loop on durable planning artifacts, makes `accept-turn --resolution human_merge` a one-command recovery path, surfaces `conflict_resolved` context across dashboard and CLI event views, hardens release alignment for onboarding docs, and corrects the CLI `--retry` docs distinction.

- 5,876 tests / 1,256 suites / 0 failures. Website build clean.
- 108 conformance fixtures across 13 protocol surfaces.

MIT licensed. Protocol v7 spec published.

GitHub: https://github.com/shivamtiwari93/agentXchain.dev
npm: https://www.npmjs.com/package/agentxchain
Docs: https://agentxchain.dev/docs/quickstart

---

## Posting Notes

- Post during US morning (10-11am ET, Mon-Thu)
- Be in the thread for the first 2 hours
- **Do not** use “constitutional governance” in the title or first reply — save it for the deep explanation if someone asks “why this architecture?”
- Anticipated objections:
  - “Why not just one good agent?” → One agent agrees with itself. Mandatory challenge catches errors a single perspective misses. Same reason code review exists for human teams.
  - “This is just a workflow engine” → Workflow engines don't reject turns for insufficient objections. The adversarial collaboration requirement is the differentiator.
  - “Too much process for AI” → The process IS the value. Uncoordinated agents produce merge conflicts and contradictory architectures. The cost of wrong code shipped fast dominates the cost of right code shipped slower.
  - “Why not CrewAI / AutoGen / LangGraph?” → Those are construction/orchestration frameworks — they help you build agents and wire them together. CrewAI and LangGraph have stronger general orchestration ergonomics and observability tooling today. AgentXchain is narrower: it governs how agents (however built) converge on a shared codebase with mandatory challenge, explicit human gates, and append-only delivery history. Complementary layers — you can use CrewAI to build the agents and AgentXchain to govern their delivery workflow.
  - “What does the audit trail actually look like?” → Show the turn-result JSON schema. Decisions, objections, risks, files_changed, verification evidence — all structured.
  - “Multi-repo sounds overengineered” → If you have one repo, you don't need it. But real products are often frontend + backend + shared libs. The coordinator ensures governed quality across the boundary, not just within one repo.
  - “Why a protocol instead of a service?” → The protocol is the durable layer. Models, runtimes, and IDEs change monthly. A governance specification that any orchestrator can implement is antifragile. The CLI is one implementation.
