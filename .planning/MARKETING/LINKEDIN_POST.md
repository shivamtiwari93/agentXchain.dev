# LinkedIn Post — AgentXchain v2.155.26

> Ready-to-post LinkedIn company-page copy for the `v2.155.26` release. Updated 2026-04-25 for the watch HTTP listener.
>
> Aggregate evidence:
> - node --test --test-timeout=60000 cli/test/compare-crewai-claims.test.js cli/test/compare-langgraph-claims.test.js cli/test/compare-openai-agents-sdk-claims.test.js cli/test/compare-autogen-claims.test.js cli/test/compare-devin-claims.test.js cli/test/compare-metagpt-claims.test.js cli/test/compare-openhands-claims.test.js cli/test/compare-codegen-claims.test.js cli/test/compare-warp-claims.test.js cli/test/comparison-pages-content.test.js cli/test/compare-page-architecture.test.js -> 98 tests / 11 suites / 0 failures / 0 skipped

---

## Post

Most multi-agent coding demos have the same flaw: the agents agree with each other, dump a diff, and nobody can explain why the result should ship.

AgentXchain is built around the opposite idea. Agents are required to challenge prior work before a governed run can advance. The value is not “more agents.” The value is a delivery protocol that makes disagreement, evidence, and approval explicit.

What that means in practice:

- Every turn must include at least one objection about the prior turn
- Humans approve phase transitions and the final ship decision
- Decisions, objections, evidence, and `files_changed` are recorded in append-only repo artifacts
- The same governance contract works across `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`

`v2.155.26` turns the watcher from a one-shot intake command into a practical automation surface:

- `watch --event-file` and `watch --event-dir` ingest external JSON events as governed work.
- `watch --daemon --event-dir <path>` keeps polling a drop directory instead of requiring a wrapper script.
- `watch --auto-start` can start governed runs from accepted intake.
- `watch --results` and `watch --result <id>` make result inspection durable and operator-friendly.
- The command reference now documents the automation path in both root and CLI READMEs.

- node --test --test-timeout=60000 cli/test/dashboard-watch-results.test.js cli/test/docs-dashboard-content.test.js cli/test/watch-listen.test.js cli/test/watch-results-inspection.test.js cli/test/watch-result-output.test.js cli/test/watch-auto-start.test.js cli/test/watch-route-intake.test.js cli/test/watch-event-intake.test.js cli/test/watch-command.test.js cli/test/watch-event-dir-daemon.test.js cli/test/frontdoor-install-surface.test.js -> 115 tests / 19 suites / 0 failures / 0 skipped
- 108 conformance fixtures across 13 protocol surfaces

Fastest proof path:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

Links:
- Docs: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

Suggested hashtags: `#AgentXchain #AIEngineering #OpenSource #DevTools #MultiAgentSystems`
