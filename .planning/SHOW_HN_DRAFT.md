# Show HN Draft — AgentXchain v2.155.42

> Draft mirror for `.planning/MARKETING/HN_SUBMISSION.md`. Updated 2026-04-26 after BUG-88 follow-up: recursive generated export exclusion and large JSON caps.
>
> Aggregate evidence:
> - node --test --test-timeout=60000 cli/test/compare-crewai-claims.test.js cli/test/compare-langgraph-claims.test.js cli/test/compare-openai-agents-sdk-claims.test.js cli/test/compare-autogen-claims.test.js cli/test/compare-devin-claims.test.js cli/test/compare-metagpt-claims.test.js cli/test/compare-openhands-claims.test.js cli/test/compare-codegen-claims.test.js cli/test/compare-warp-claims.test.js cli/test/comparison-pages-content.test.js cli/test/compare-page-architecture.test.js -> 98 tests / 11 suites / 0 failures / 0 skipped
> - node --test --test-timeout=120000 cli/test/agent-talk-word-cap.test.js cli/test/current-release-surface.test.js -> 31 tests / 2 suites / 0 failures / 0 skipped
> - bash cli/scripts/verify-post-publish.sh --target-version 2.155.41 -> 7249 tests / 1467 suites / 0 failures / 5 skipped
>
> Aggregate evidence:
> - 10-cycle governed dogfood on tusq.dev: 987 lines product code, 42 checkpoint commits, all 4 phases per cycle
> - 108 conformance fixtures across 13 protocol surfaces
> - Historical beta baseline: 7,078+ tests / 623 test files / 71 beta-tester scenario suites / 0 failures
> - 75 bugs closed (BUG-1 through BUG-75), spec-driven with shipped-package proof
> - Durable evidence index: `.planning/dogfood-tusq-dev-evidence/DOGFOOD-EXTENDED-10-CYCLES-EVIDENCE-INDEX.md`

---

## Title

Show HN: AgentXchain — Open-source protocol where AI agents must challenge each other before code ships

## URL

https://agentxchain.dev

## Text

Hi HN, I've been building AgentXchain — an open-source governance protocol for multi-agent software delivery.

The problem: when you let multiple AI agents work on the same codebase, they tend to agree with each other, quality drifts, nobody owns decisions, and there is no clear proof of what is actually shippable.

AgentXchain treats multi-agent delivery as a governed system:

- Every agent turn MUST include at least one objection about the prior agent's work. Blind agreement is rejected.
- Phase gates enforce that real artifacts exist before work advances.
- Human approval remains available for governed phase transitions and ship decisions.
- Every decision goes into an append-only audit ledger.
- Works with any model or runtime: Claude Code, Cursor, direct API calls, MCP servers, remote agents, or manual human turns.

The design borrows from institutional governance: collective output improves when disagreement is structured, not when agents are asked to be agreeable.

**30-second demo, no API keys needed:**

```bash
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

This runs a complete governed lifecycle: PM scopes a feature, Dev implements while resolving objections, QA reviews against acceptance criteria, and the protocol records decisions and evidence.

**What shipped by v2.155.42:**

- Perpetual continuous mode: `agentxchain run --continuous --on-idle perpetual`
- Parallel turns: up to 4 agents concurrently within a governed run, with dispatch isolation and serialized acceptance
- Delegation chains: a senior role delegates to specialists, reviews their output, and decides next steps (delegate → execute → review)
- Real dogfood proof: 10 governed runs on tusq.dev produced 987 lines of product code across 42 checkpoint commits
- Every dogfood cycle traversed planning -> implementation -> QA -> launch
- 75 bugs closed across the beta cycle, including ghost-turn auto-retry, operator-commit reconciliation, idle-expansion charter materialization, stale-run recovery, and approval-policy coupling
- All 5 adapters proven live: `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`
- `local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof; `manual` is the governed human control path
- 108 conformance fixtures across 13 protocol surfaces
- Protocol v7 spec published with docs and conformance references
- Historical beta baseline: 7,078+ tests across 623 test files, including 71 beta-tester scenario suites with command-chain integration coverage
- Spec-driven: every bug fix has a spec in `.planning/`, acceptance tests, and shipped-package proof

Durable evidence for the dogfood proof lives at `.planning/dogfood-tusq-dev-evidence/DOGFOOD-EXTENDED-10-CYCLES-EVIDENCE-INDEX.md`.

For the real CLI flow beyond the demo:

```bash
npm install -g agentxchain
agentxchain init --governed --goal "Ship one small governed change"
agentxchain doctor
agentxchain run --continuous --on-idle perpetual
```

MIT licensed. Protocol is the product. The CLI is one implementation.

GitHub: https://github.com/shivamtiwari93/agentXchain.dev
npm: https://www.npmjs.com/package/agentxchain
Website: https://agentxchain.dev
Docs: https://agentxchain.dev/docs/quickstart

Happy to answer questions about the mandatory challenge design, the architecture, or the evidence approach.

---

## Posting Notes

- Submit during an eligible Tuesday-Thursday launch window, ideally 10-11am ET.
- Next queued window: Wednesday 2026-04-29, 10-11am ET.
- Be in the thread for at least 3 hours after posting.
- Do not use the historical `/launch` snapshot as the submission URL; submit https://agentxchain.dev.
- Do not use "constitutional governance" in the title or first reply. Save that framing for a deeper architecture answer if asked.

## Anticipated Objections

- "Why not just one good agent?" One agent agrees with itself. Mandatory challenge catches errors a single perspective misses. Same reason code review exists for human teams.
- "This is just a workflow engine." Workflow engines do not reject turns for insufficient objections. The adversarial collaboration requirement is the differentiator.
- "Too much process for AI." The process is the value. Uncoordinated agents produce merge conflicts and contradictory architectures; governed turns make convergence inspectable.
- "Why not CrewAI / AutoGen / LangGraph?" Those help build and orchestrate agents. AgentXchain governs how agents converge on a shared codebase with charters, gates, objections, and audit history.
- "What does the audit trail actually look like?" Show the turn-result JSON schema and the dogfood evidence index.
- "Has this been used on a real project?" Yes. AgentXchain dogfooded tusq.dev for 10 governed runs, producing 987 lines of product code with zero human intervention during the governed cycles.
