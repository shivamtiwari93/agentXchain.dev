# Reddit Posts — AgentXchain v2.155.47

> Ready-to-post content for Reddit for the `v2.155.47` release. Updated 2026-04-27 for BUG-93 fix: DOGFOOD proof evidence no longer blocks retained-turn reacceptance.
> All five adapter types are proven live. Four non-manual adapter types have real-model proof. Full evidence surface at agentxchain.dev.
>
> Aggregate evidence:
> - node --test --test-timeout=60000 cli/test/compare-crewai-claims.test.js cli/test/compare-langgraph-claims.test.js cli/test/compare-openai-agents-sdk-claims.test.js cli/test/compare-autogen-claims.test.js cli/test/compare-devin-claims.test.js cli/test/compare-metagpt-claims.test.js cli/test/compare-openhands-claims.test.js cli/test/compare-codegen-claims.test.js cli/test/compare-warp-claims.test.js cli/test/comparison-pages-content.test.js cli/test/compare-page-architecture.test.js -> 98 tests / 11 suites / 0 failures / 0 skipped
> - node --test --test-timeout=120000 cli/test/agent-talk-word-cap.test.js cli/test/current-release-surface.test.js -> 31 tests / 2 suites / 0 failures / 0 skipped
> - npm test -- --test-timeout=60000 -> 7271 tests / 1471 suites / 0 failures / 5 skipped

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

What shipped in v2.155.47:

- Continuous resume reattempts `acceptTurn()` for active `failed_acceptance` turns with valid staged results.
- Arbitrary planning files remain actor-owned and fail closed if changed outside a retained turn.
- Auto-checkpoint remains attached to the normal framework acceptance path.
- Regression coverage proves both successful reacceptance and the missing-staging negative path.

Proof:

- node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-91-baseline-dirty-unchanged-acceptance.test.js cli/test/repo-observer.test.js cli/test/beta-tester-scenarios/bug-92-failed-acceptance-run-resume.test.js -> 100 tests / 20 suites / 0 failures
- npm test -- --test-timeout=60000 -> 7271 tests / 1471 suites / 0 failures / 5 skipped
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

**Title:** AgentXchain v2.155.47 — full-auto resume reaccepts failed-acceptance staged turns

**Body:**

AgentXchain is an open-source protocol for governing multi-agent software delivery. The core rule is simple: agents are required to challenge prior work before a governed run can advance.

v2.155.47 fixes a full-auto recovery gap found during dogfooding:

- DOGFOOD-100 proof evidence files are exempt from retained-turn dirty parity
- arbitrary planning files still fail closed when changed outside the retained turn
- the retained-turn recovery path now carries BUG-91, BUG-92, and BUG-93 together

The governance model is runtime-agnostic: manual, local CLI, API proxy, MCP, and remote_agent adapters are all proven live. The non-manual adapters have real-model proof; manual remains the governed human path.

Evidence:

- node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-91-baseline-dirty-unchanged-acceptance.test.js cli/test/repo-observer.test.js cli/test/beta-tester-scenarios/bug-92-failed-acceptance-run-resume.test.js -> 100 tests / 20 suites / 0 failures
- npm test -- --test-timeout=60000 -> 7271 tests / 1471 suites / 0 failures / 5 skipped
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

v2.155.47 fixes full-auto resume so failed-acceptance staged turns can be reaccepted without operator-side `accept-turn` recovery.

Try the zero-key demo:

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

- 108 conformance fixtures across 13 protocol surfaces
- npm test -- --test-timeout=60000 -> 7271 tests / 1471 suites / 0 failures / 5 skipped

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
- v2.155.47 fixes failed-acceptance resume without operator-side recovery

Try it in 30 seconds:

`npx --yes -p agentxchain@latest -c "agentxchain demo"`

MIT licensed. https://agentxchain.dev

**URL:** https://reddit.com/r/ChatGPT/submit

---

## Posting Instructions

1. Confirm `npm view agentxchain@2.155.25 version` before posting.
2. Post during US morning hours, preferably Tuesday-Thursday 10-11am ET.
3. Post to r/programming first, then r/artificial and r/LocalLLaMA 30-60 minutes later, then r/ChatGPT.
4. Lead with the demo command because it works without API keys.
5. If someone hits `unknown command 'demo'`, reply with `npx --yes -p agentxchain@latest -c "agentxchain demo"` and explain that npm can resolve a stale global install first.
6. Be in all threads for the first 2 hours to answer questions.
7. If asked how this differs from CrewAI or LangGraph: those frameworks build/orchestrate agents; AgentXchain governs how agents converge on shippable software.
