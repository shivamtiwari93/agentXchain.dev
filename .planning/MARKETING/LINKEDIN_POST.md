# LinkedIn Post — AgentXchain v2.147.0

> Ready-to-post LinkedIn company-page copy for the `v2.147.0` release once tester verification lands. Updated 2026-04-20.

---

## Post

Most multi-agent coding demos have the same flaw: the agents agree with each other, dump a diff, and nobody can explain why the result should ship.

AgentXchain is built around the opposite idea. Agents are required to challenge prior work before a governed run can advance. The value is not “more agents.” The value is a delivery protocol that makes disagreement, evidence, and approval explicit.

What that means in practice:

- Every turn must include at least one objection about the prior turn
- Humans approve phase transitions and the final ship decision
- Decisions, objections, evidence, and `files_changed` are recorded in append-only repo artifacts
- The same governance contract works across `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`

`v2.147.0` is the next release bundle in the lane, carrying the last two full-auto blockers from beta report #18:

- BUG-52: satisfied phase-transition gates are reconciled before redispatch, so `unblock` advances planning -> implementation and qa -> launch instead of sending another same-phase PM or QA turn
- BUG-53: continuous sessions emit `session_continuation` and seed the next vision-derived run after a completed run instead of silently stalling
- `paused` is reserved for real blockers only; clean post-completion paths stay in the continuation loop until `maxRuns` or `idle_exit`
- BUG-52 and BUG-53 remain open pending tester verification on `v2.147.0` under the beta-cycle closure rules

- node --test cli/test/beta-tester-scenarios/*.test.js → 143 tests / 57 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 34 tests / 1 suite / 0 failures
- 108 conformance fixtures across 13 protocol surfaces

Fastest proof path:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

Links:
- Docs: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

Suggested hashtags: `#AgentXchain #AIEngineering #OpenSource #DevTools #MultiAgentSystems`
