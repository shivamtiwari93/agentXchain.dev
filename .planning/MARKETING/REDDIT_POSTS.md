# Reddit Posts — AgentXchain v2.159.0

> Ready-to-post content for Reddit for the `v2.159.0` release, staged on the current released line `v2.158.0`. Updated 2026-06-29 for role-charter well-formedness validation (the new `agentxchain role validate` command) plus a public-surface accuracy and light-mode pass. This is an honest quality and correctness release plus one new validation command — not a big feature launch. Produced by dogfooding agentXchain on itself in a VISION-driven lights-out run.
> All five adapter types are proven live. Four non-manual adapter types have real-model proof. Full evidence surface at agentxchain.dev.
>
> Aggregate evidence: 108 conformance fixtures across 13 protocol surfaces.
> - npm test -- --test-timeout=60000 -> 7724 tests / 1579 suites / 0 failures / 5 skipped

---

## r/programming

**Title:** Show r/programming: AgentXchain — open-source protocol where AI agents must challenge each other before code ships

**Body:**

I have been building AgentXchain, an open-source governance protocol for multi-agent software delivery.

The problem: multi-agent coding systems often make several agents agree with each other, dump a diff, and leave operators guessing whether the result should ship. AgentXchain treats the delivery process itself as the product:

- Every agent turn must include at least one objection about the prior turn. Blind agreement is a protocol violation.
- Humans can approve governed phase transitions and the final ship decision.
- Every decision, objection, evidence item, and `files_changed` claim is recorded in append-only repo artifacts.
- Phase gates enforce that real artifacts exist before work advances.
- The same contract works across `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`.

What shipped in v2.159.0 (an honest quality + correctness release, plus one new validation command):

- `agentxchain role validate` scores every configured role against the VISION's four-part charter invariant: (1) a mandate, (2) a coherent authority×runtime boundary, (3) production of governed artifacts, (4) participation in the structured workflow. Malformed or no-op roles are now caught before a governed run instead of after. Backed by a new `role-charter.js` scorer.
- Public-surface accuracy + light-mode pass: the docs site now renders correctly in light mode (it was dark cards on a white background), with accessibility polish.
- Documentation corrected against the shipped CLI: intake flag syntax, the `write_authority` role key across the `api_proxy` integration guides, continuous-mode defaults (100/3), the parallel-turns config shape, and the CLI reference for the qa phase, `mission bind-coordinator`, `ci-report`, and the `named_decisions` barrier.
- Examples hardening: removed an obsolete example, fixed the remote-agent-bridge deterministic proof, corrected the README, and added two new READMEs.

The role-charter work was itself produced by dogfooding agentXchain on its own repo in a VISION-driven lights-out run.

Proof:

- 108 conformance fixtures across 13 protocol surfaces
- All 5 adapter types proven live
- `local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof; `manual` is the governed human control path

See it in 30 seconds, no API keys needed:

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

MIT licensed. Protocol is the product; the CLI is one implementation.

- Website: https://agentxchain.dev
- Quickstart: https://agentxchain.dev/docs/quickstart
- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain

**URL:** https://reddit.com/r/programming/submit

---

## r/artificial

**Title:** AgentXchain v2.159.0 — role-charter validation (`role validate`) plus a public-surface accuracy and light-mode pass

**Body:**

AgentXchain is an open-source protocol for governing multi-agent software delivery. The core rule is simple: agents are required to challenge prior work before a governed run can advance.

v2.159.0 is an honest quality + correctness release plus one new validation command, surfaced by dogfooding agentXchain on itself in a VISION-driven lights-out run:

- `agentxchain role validate` scores every configured role against the VISION's four-part charter invariant: (1) a mandate, (2) a coherent authority×runtime boundary, (3) production of governed artifacts, (4) participation in the structured workflow. Malformed or no-op roles are caught before a governed run instead of after. Backed by a new `role-charter.js` scorer.
- a public-surface accuracy + light-mode pass: the docs site now renders correctly in light mode (it was dark cards on white) with accessibility polish
- documentation corrected against the shipped CLI: intake flag syntax, the `write_authority` role key across the `api_proxy` integration guides, continuous-mode defaults (100/3), the parallel-turns config shape, and the CLI reference for the qa phase, `mission bind-coordinator`, `ci-report`, and the `named_decisions` barrier
- examples hardening: removed an obsolete example, fixed the remote-agent-bridge deterministic proof, corrected the README, and added two new READMEs

The governance model is runtime-agnostic: manual, local CLI, API proxy, MCP, and remote_agent adapters are all proven live. The non-manual adapters have real-model proof; manual remains the governed human path.

Evidence:

- 108 conformance fixtures across 13 protocol surfaces

Try it:

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

https://agentxchain.dev | https://github.com/shivamtiwari93/agentXchain.dev

**URL:** https://reddit.com/r/artificial/submit

---

## r/LocalLLaMA

**Title:** AgentXchain — model-agnostic governance for multi-agent coding workflows

**Body:**

If you run local or mixed-model coding agents, the failure mode is usually not lack of intelligence. It is coordination: overlapping work, weak review, and no durable decision trail.

AgentXchain governs the collaboration layer:

- every turn must challenge prior work
- phase gates require real artifacts
- decisions and evidence are append-only
- local CLI, API proxy, MCP, remote_agent, and manual paths run under one contract
- manual is the governed human control path, while `local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof

v2.159.0 is an honest quality + correctness release plus one new validation command. It adds `agentxchain role validate`, which scores every configured role against the VISION's four-part charter invariant (a mandate, a coherent authority×runtime boundary, production of governed artifacts, and participation in the structured workflow) so malformed or no-op roles are caught before a governed run instead of after — backed by a new `role-charter.js` scorer. It also lands a public-surface accuracy + light-mode pass: the docs site now renders correctly in light mode, documentation is corrected against the shipped CLI, and the examples are hardened.

Try the zero-key demo:

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

- 108 conformance fixtures across 13 protocol surfaces

**URL:** https://reddit.com/r/LocalLLaMA/submit

---

## r/ChatGPT

**Title:** Built an open-source protocol where AI agents are required to disagree before code can ship

**Body:**

Most multi-agent AI demos show agents cooperating smoothly. The problem is that smooth agreement often hides missing review.

AgentXchain is an open-source governance protocol where:

- every agent turn must challenge the prior turn
- humans can approve phase transitions and ship decisions
- decisions, objections, evidence, and files changed are auditable
- manual, local CLI, API proxy, MCP, and remote_agent adapters use the same protocol
- v2.159.0 adds `role validate`, which scores every configured role against the VISION's four-part charter invariant so malformed or no-op roles are caught before a governed run, plus a public-surface accuracy and light-mode pass

Try it in 30 seconds:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

MIT licensed. https://agentxchain.dev

**URL:** https://reddit.com/r/ChatGPT/submit

---

## Posting Instructions

1. Confirm `npm view agentxchain@2.159.0 version` before posting.
2. Post during US morning hours, preferably Tuesday-Thursday 10-11am ET.
3. Post to r/programming first, then r/artificial and r/LocalLLaMA 30-60 minutes later, then r/ChatGPT.
4. Lead with the demo command because it works without API keys.
5. If someone hits `unknown command 'demo'`, reply with `npx --yes -p agentxchain@latest -c "agentxchain demo"` and explain that npm can resolve a stale global install first.
6. Be in all threads for the first 2 hours to answer questions.
7. If asked how this differs from CrewAI or LangGraph: those frameworks build/orchestrate agents; AgentXchain governs how agents converge on shippable software.
