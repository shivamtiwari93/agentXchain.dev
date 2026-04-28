# LinkedIn Post — AgentXchain v2.155.59

> Ready-to-post LinkedIn company-page copy for the `v2.155.59` release. Updated 2026-04-28 for BUG-105 fix: strict intent coverage now reads normalized evidence summaries and punctuation-normalized acceptance text.
>
> Aggregate evidence:
> - node --test --test-timeout=60000 cli/test/compare-crewai-claims.test.js cli/test/compare-langgraph-claims.test.js cli/test/compare-openai-agents-sdk-claims.test.js cli/test/compare-autogen-claims.test.js cli/test/compare-devin-claims.test.js cli/test/compare-metagpt-claims.test.js cli/test/compare-openhands-claims.test.js cli/test/compare-codegen-claims.test.js cli/test/compare-warp-claims.test.js cli/test/comparison-pages-content.test.js cli/test/compare-page-architecture.test.js -> 98 tests / 11 suites / 0 failures / 0 skipped
> - node --test --test-timeout=120000 cli/test/agent-talk-word-cap.test.js cli/test/current-release-surface.test.js -> 31 tests / 2 suites / 0 failures / 0 skipped
> - npm test -- --test-timeout=60000 -> 7310 tests / 1482 suites / 0 failures / 5 skipped

---

## Post

Most multi-agent coding demos have the same flaw: the agents agree with each other, dump a diff, and nobody can explain why the result should ship.

AgentXchain is built around the opposite idea. Agents are required to challenge prior work before a governed run can advance. The value is not “more agents.” The value is a delivery protocol that makes disagreement, evidence, and approval explicit.

What that means in practice:

- Every turn must include at least one objection about the prior turn
- Humans approve phase transitions and the final ship decision
- Decisions, objections, evidence, and `files_changed` are recorded in append-only repo artifacts
- The same governance contract works across `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`

`v2.155.59` fixes strict intent coverage over normalized structured verification evidence in full-auto continuous mode (BUG-105):

- Intent coverage searches `verification.evidence_summary` after BUG-104 moves typed observations out of `machine_evidence[]`.
- Acceptance matching now tokenizes word characters, so punctuation does not hide explicit bounded/testable/non-duplicate proof.
- Missing acceptance proof still fails closed; the negative regression keeps this path strict.
- This keeps the full-auto path inside the framework instead of requiring operator-side staging edits.

- node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-105-intent-coverage-structured-evidence.test.js cli/test/beta-tester-scenarios/bug-104-structured-machine-evidence-normalization.test.js cli/test/beta-tester-scenarios/bug-103-decision-title-statement-normalization.test.js -> 7 tests / 3 suites / 0 failures
- npm test -- --test-timeout=60000 -> 7310 tests / 1482 suites / 0 failures / 5 skipped
- 108 conformance fixtures across 13 protocol surfaces

Fastest proof path:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

Links:
- Docs: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

Suggested hashtags: `#AgentXchain #AIEngineering #OpenSource #DevTools #MultiAgentSystems`
