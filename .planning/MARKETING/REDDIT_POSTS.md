# Reddit Posts — AgentXchain v2.155.28

> Ready-to-post content for Reddit for the `v2.155.28` release. Updated 2026-04-25 for the watch HTTP listener.
> All five adapter types are proven live. Four non-manual adapter types have real-model proof. Full evidence surface at agentxchain.dev.
>
> Aggregate evidence:
> - node --test --test-timeout=60000 cli/test/compare-crewai-claims.test.js cli/test/compare-langgraph-claims.test.js cli/test/compare-openai-agents-sdk-claims.test.js cli/test/compare-autogen-claims.test.js cli/test/compare-devin-claims.test.js cli/test/compare-metagpt-claims.test.js cli/test/compare-openhands-claims.test.js cli/test/compare-codegen-claims.test.js cli/test/compare-warp-claims.test.js cli/test/comparison-pages-content.test.js cli/test/compare-page-architecture.test.js -> 98 tests / 11 suites / 0 failures / 0 skipped
> - node --test --test-timeout=180000 cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js cli/test/beta-tester-scenarios/bug-76-roadmap-open-work-continuous.test.js cli/test/vision-reader.test.js cli/test/continuous-run.test.js cli/test/status-operator-actions.test.js -> 107 tests / 26 suites / 0 failures / 0 skipped

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

What shipped in v2.155.28:

- `watch --event-file` and `watch --event-dir` ingest external JSON events as governed work.
- `watch --daemon --event-dir <path>` keeps polling a drop directory for incoming events.
- `watch --auto-start` can start governed runs from accepted intake.
- `watch --results` and `watch --result <id>` make result inspection durable and operator-friendly.
- Root and CLI command references now document the watcher automation surface.

Proof:

- node --test --test-timeout=60000 cli/test/dashboard-watch-results.test.js cli/test/docs-dashboard-content.test.js cli/test/watch-listen.test.js cli/test/watch-results-inspection.test.js cli/test/watch-result-output.test.js cli/test/watch-auto-start.test.js cli/test/watch-route-intake.test.js cli/test/watch-event-intake.test.js cli/test/watch-command.test.js cli/test/watch-event-dir-daemon.test.js cli/test/frontdoor-install-surface.test.js -> 115 tests / 19 suites / 0 failures / 0 skipped
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

**Title:** AgentXchain v2.155.28 — watch automation for governed multi-agent coding workflows

**Body:**

AgentXchain is an open-source protocol for governing multi-agent software delivery. The core rule is simple: agents are required to challenge prior work before a governed run can advance.

v2.155.28 adds a practical automation surface:

- external JSON events can enter through `watch --event-file` or `watch --event-dir`
- `watch --daemon --event-dir <path>` polls a drop directory
- `watch --auto-start` starts governed runs from accepted intake
- `watch --results` and `watch --result <id>` expose durable result records

The governance model is runtime-agnostic: manual, local CLI, API proxy, MCP, and remote_agent adapters are all proven live. The non-manual adapters have real-model proof; manual remains the governed human path.

Evidence:

- node --test --test-timeout=60000 cli/test/dashboard-watch-results.test.js cli/test/docs-dashboard-content.test.js cli/test/watch-listen.test.js cli/test/watch-results-inspection.test.js cli/test/watch-result-output.test.js cli/test/watch-auto-start.test.js cli/test/watch-route-intake.test.js cli/test/watch-event-intake.test.js cli/test/watch-command.test.js cli/test/watch-event-dir-daemon.test.js cli/test/frontdoor-install-surface.test.js -> 115 tests / 19 suites / 0 failures / 0 skipped
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

v2.155.28 adds watcher automation so external events can enter governed intake and become durable result records.

Try the zero-key demo:

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

- 108 conformance fixtures across 13 protocol surfaces
- node --test --test-timeout=60000 cli/test/dashboard-watch-results.test.js cli/test/docs-dashboard-content.test.js cli/test/watch-listen.test.js cli/test/watch-results-inspection.test.js cli/test/watch-result-output.test.js cli/test/watch-auto-start.test.js cli/test/watch-route-intake.test.js cli/test/watch-event-intake.test.js cli/test/watch-command.test.js cli/test/watch-event-dir-daemon.test.js cli/test/frontdoor-install-surface.test.js -> 115 tests / 19 suites / 0 failures / 0 skipped

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
- v2.155.28 adds watcher automation for external-event intake, auto-started runs, and result inspection

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
