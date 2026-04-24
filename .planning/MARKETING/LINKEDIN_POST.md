# LinkedIn Post — AgentXchain v2.155.0

> Ready-to-post LinkedIn company-page copy for the `v2.155.0` release once tester verification lands. Updated 2026-04-24 for BUG-60 perpetual continuous idle-expansion policy.
>
> Aggregate evidence:
> - node --test cli/test/continuous-run.test.js cli/test/schedule-daemon-health-e2e.test.js cli/test/claim-reality-preflight.test.js cli/test/docs-cli-intake-content.test.js -> 136 tests / 28 suites / 0 failures / 0 skipped

---

## Post

Most multi-agent coding demos have the same flaw: the agents agree with each other, dump a diff, and nobody can explain why the result should ship.

AgentXchain is built around the opposite idea. Agents are required to challenge prior work before a governed run can advance. The value is not “more agents.” The value is a delivery protocol that makes disagreement, evidence, and approval explicit.

What that means in practice:

- Every turn must include at least one objection about the prior turn
- Humans approve phase transitions and the final ship decision
- Decisions, objections, evidence, and `files_changed` are recorded in append-only repo artifacts
- The same governance contract works across `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`

`v2.149.1` is the next release bundle in the lane, converting BUG-54 from "better diagnostics" into an actual fail-fast product contract:

- BUG-54 auth preflight: Claude `local_cli` runtimes now fail before spawn when neither env auth nor `--bare` is present, using the same `claude_auth_preflight_failed` signal across adapter dispatch, `connector check`, and `connector validate`
- BUG-54 diagnostics and runbook stay in the release: `process_exit` forensic fields, reproduction harness, tester runbook, and per-runtime watchdog override
- BUG-52 keeps the four-lane reconciler recovery proof at both source and packaged boundaries
- BUG-55 keeps wrong-lineage checkpoint surfacing and `undeclared_verification_outputs` rejection
- BUG-53 keeps continuous auto-chain and `idle_exit` proof in the release lane
- BUG-54, BUG-52, BUG-55, and BUG-53 remain open pending tester verification on `v2.149.1`

- node --test cli/test/beta-tester-scenarios/ → 172 tests / 64 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 42 tests / 1 suite / 0 failures
- 108 conformance fixtures across 13 protocol surfaces

Fastest proof path:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

Links:
- Docs: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

Suggested hashtags: `#AgentXchain #AIEngineering #OpenSource #DevTools #MultiAgentSystems`
