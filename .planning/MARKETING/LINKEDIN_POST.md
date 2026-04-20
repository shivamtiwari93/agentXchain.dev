# LinkedIn Post — AgentXchain v2.148.0

> Ready-to-post LinkedIn company-page copy for the `v2.148.0` release once tester verification lands. Updated 2026-04-20.

---

## Post

Most multi-agent coding demos have the same flaw: the agents agree with each other, dump a diff, and nobody can explain why the result should ship.

AgentXchain is built around the opposite idea. Agents are required to challenge prior work before a governed run can advance. The value is not “more agents.” The value is a delivery protocol that makes disagreement, evidence, and approval explicit.

What that means in practice:

- Every turn must include at least one objection about the prior turn
- Humans approve phase transitions and the final ship decision
- Decisions, objections, evidence, and `files_changed` are recorded in append-only repo artifacts
- The same governance contract works across `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`

`v2.148.0` is the next release bundle in the lane, hardening the local-CLI adapter and acceptance boundary against beta-report signals:

- BUG-54 adapter timing diagnostics: `startup_latency_ms` and `elapsed_since_spawn_ms` now land on every adapter-diag row so tight `startup_watchdog_ms` values can be tuned from observed real-Claude startup instead of guessed
- BUG-54 real-Claude stdin proof: 10 consecutive `claude --print --dangerously-skip-permissions` dispatches with `prompt_transport: "stdin"`, handle growth bounded, zero `stdin_error`, and the gated probe fails loudly instead of silently skipping on hung Claude
- BUG-55 sub-A checkpoint completeness: declared `files_changed` paths partition into `staged` / `already_committed_upstream` / `genuinely_missing`; the tester-reported dirty-survival gate holds while the legitimate BUG-23 pre-commit pattern stops false-positiving
- BUG-55 sub-B `undeclared_verification_outputs`: acceptance rejects turns whose declared verification produced undeclared fixture outputs, with a dedicated remediation pointer to `verification.produced_files`
- BUG-54 and BUG-55 sub-A/B remain open pending tester verification on `v2.148.0`; BUG-52 and BUG-53 carry forward from v2.147.0 under tester verification

- node --test cli/test/beta-tester-scenarios/*.test.js → 153 tests / 61 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 36 tests / 1 suite / 0 failures
- 108 conformance fixtures across 13 protocol surfaces

Fastest proof path:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

Links:
- Docs: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

Suggested hashtags: `#AgentXchain #AIEngineering #OpenSource #DevTools #MultiAgentSystems`
