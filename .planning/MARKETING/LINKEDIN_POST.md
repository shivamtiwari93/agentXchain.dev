# LinkedIn Post — AgentXchain v2.145.0

> Ready-to-post LinkedIn company-page copy for the `v2.145.0` release once tester verification lands. Updated 2026-04-19.

---

## Post

Most multi-agent coding demos have the same flaw: the agents agree with each other, dump a diff, and nobody can explain why the result should ship.

AgentXchain is built around the opposite idea. Agents are required to challenge prior work before a governed run can advance. The value is not “more agents.” The value is a delivery protocol that makes disagreement, evidence, and approval explicit.

What that means in practice:

- Every turn must include at least one objection about the prior turn
- Humans approve phase transitions and the final ship decision
- Decisions, objections, evidence, and `files_changed` are recorded in append-only repo artifacts
- The same governance contract works across `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`

`v2.145.0` is the next release bundle in the lane, carrying the BUG-47..50 continuation-state consistency fixes:

- stale `running` turns are now reconciled into retained `stalled` turns with explicit stale-turn recovery guidance
- stale injected-priority markers are cleared when the target intent is superseded or otherwise non-actionable
- fresh continuation runs now advance `accepted_integration_ref` correctly on checkpoint
- child-run `run-history.jsonl` counters stay isolated from inherited parent metadata
- BUG-47, BUG-48, BUG-49, and BUG-50 remain open pending tester verification under the beta-cycle closure rules

- 6,297 tests / 1,315 suites / 0 failures
- 108 conformance fixtures across 13 protocol surfaces

Fastest proof path:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

Links:
- Docs: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

Suggested hashtags: `#AgentXchain #AIEngineering #OpenSource #DevTools #MultiAgentSystems`
