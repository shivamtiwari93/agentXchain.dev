# Show HN Draft — AgentXchain

> Draft for Hacker News submission. Iterate before posting.

---

## Title

Show HN: AgentXchain - Agents required to challenge each other before shipping code

## URL

https://agentxchain.dev

## Text

I got tired of multi-agent coding demos where three agents agree with each other, dump a diff, and nobody can explain why the code should ship. So I built a workflow where **agents are required to challenge each other before the run can advance**.

AgentXchain is an open-source protocol + CLI for governed software delivery:

- **Every turn must include an objection.** Blind agreement is rejected.
- **The protocol requires human approval for phase transitions and final completion.** Agents can work between gates, but they cannot self-ship.
- **Every turn writes structured history.** Summary, objections, decisions, files changed, and verification evidence go into append-only JSONL.
- **The runtime is swappable.** Manual turns, local CLI agents, and API-backed agents all run under the same protocol.

Example flow:

```bash
npx agentxchain init --governed
agentxchain step --role pm
agentxchain accept-turn
agentxchain approve-transition
agentxchain step --role dev
```

The point is not “more agents.” The point is better convergence: disagreement by default, explicit gates, and a readable audit trail for how the team reached a ship decision.

800+ tests. MIT licensed.

GitHub: https://github.com/shivamtiwari93/agentXchain.dev

---

## Posting Notes

- Post during US morning (10-11am ET, Mon-Thu)
- Be in the thread for the first 2 hours
- **Do not** use "constitutional governance" in the title or first reply — save it for the deep explanation if someone asks "why this architecture?"
- Anticipated objections:
  - "Why not just one good agent?" → One agent agrees with itself. Mandatory challenge catches errors a single perspective misses. Same reason code review exists for human teams.
  - "This is just a workflow engine" → Workflow engines don't reject turns for insufficient objections. The adversarial collaboration requirement is the differentiator.
  - "Too much process for AI" → The process IS the value. Uncoordinated agents produce merge conflicts and contradictory architectures. The cost of wrong code shipped fast dominates the cost of right code shipped slower.
  - "Why not CrewAI / AutoGen / LangGraph?" → Those are construction/orchestration frameworks — they help you build agents and wire them together. CrewAI and LangGraph have stronger general orchestration ergonomics and observability tooling today. AgentXchain is narrower: it governs how agents (however built) converge on a shared codebase with mandatory challenge, explicit human gates, and append-only delivery history. Complementary layers — you can use CrewAI to build the agents and AgentXchain to govern their delivery workflow.
  - "What does the audit trail actually look like?" → Show the turn-result JSON schema. Decisions, objections, risks, files_changed, verification evidence — all structured.
