# LinkedIn Post — AgentXchain v2.159.0

> Ready-to-post LinkedIn company-page copy for the `v2.159.0` release. Updated 2026-06-29 for the new `role validate` command (role-charter well-formedness scoring) plus a public-surface accuracy and light-mode pass. An honest quality + correctness release, not a big feature launch.
>
> Aggregate evidence:
>
> - npm test -- --test-timeout=60000 -> 7724 tests / 1579 suites / 0 failures / 5 skipped

---

## Post

Most multi-agent coding demos have the same flaw: the agents agree with each other, dump a diff, and nobody can explain why the result should ship.

AgentXchain is built around the opposite idea. Agents are required to challenge prior work before a governed run can advance. The value is not “more agents.” The value is a delivery protocol that makes disagreement, evidence, and approval explicit.

What that means in practice:

- Every turn must include at least one objection about the prior turn
- Humans approve phase transitions and the final ship decision
- Decisions, objections, evidence, and `files_changed` are recorded in append-only repo artifacts
- The same governance contract works across `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`

`v2.159.0` is an honest quality + correctness release with one new validation command — not a big feature launch. The headline command was produced by dogfooding AgentXchain on itself in a VISION-driven lights-out run:

- `agentxchain role validate` scores every configured role against the VISION's four-part charter invariant: (1) a mandate, (2) a coherent authority×runtime boundary, (3) production of governed artifacts, and (4) participation in the structured workflow. Malformed or no-op roles get caught before a governed run instead of after. Backed by a new `role-charter.js` scorer.
- Public-surface accuracy & light-mode pass: the docs site now renders correctly in light mode (it was showing dark cards on a white background), with accessibility polish alongside.
- Documentation corrected against the shipped CLI: intake flag syntax, the `write_authority` role key across the `api_proxy` integration guides, continuous-mode defaults (100/3), the parallel-turns config shape, and the CLI reference for the `qa` phase, `mission bind-coordinator`, `ci-report`, and the `named_decisions` barrier.
- Examples hardening: removed an obsolete example, fixed the remote-agent-bridge deterministic proof, tightened README accuracy, and added two new READMEs.

Every claim above is checkable from the shipped surface: run `agentxchain role validate` against your own config to see the charter scores, and the corrected docs now match the CLI you actually get.

Fastest proof path:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

Links:
- Docs: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

Suggested hashtags: `#AgentXchain #AIEngineering #OpenSource #DevTools #MultiAgentSystems`
