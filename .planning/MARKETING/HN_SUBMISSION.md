# Hacker News Submission — AgentXchain v2.155.73

> Ready-to-post for `v2.155.73` launch window. Updated 2026-05-02 for recovery classification, crash-resume PID guards, continuous checkpoint consistency, configurable deadlines, intake persistence, and Claude recovery hardening.
>
> Aggregate evidence:
> - node --test --test-timeout=60000 cli/test/compare-crewai-claims.test.js cli/test/compare-langgraph-claims.test.js cli/test/compare-openai-agents-sdk-claims.test.js cli/test/compare-autogen-claims.test.js cli/test/compare-devin-claims.test.js cli/test/compare-metagpt-claims.test.js cli/test/compare-openhands-claims.test.js cli/test/compare-codegen-claims.test.js cli/test/compare-warp-claims.test.js cli/test/comparison-pages-content.test.js cli/test/compare-page-architecture.test.js -> 98 tests / 11 suites / 0 failures / 0 skipped
> - node --test --test-timeout=120000 cli/test/agent-talk-word-cap.test.js cli/test/current-release-surface.test.js -> 31 tests / 2 suites / 0 failures / 0 skipped
> - npm test -- --test-timeout=60000 -> 7386 tests / 1485 suites / 0 failures / 0 skipped
>
> Aggregate evidence:
> - 10-cycle governed dogfood on tusq.dev: 987 lines product code, 42 checkpoint commits, all 4 phases per cycle
> - 108 conformance fixtures across 13 protocol surfaces
> - Historical beta baseline: 7,078+ tests / 623 test files / 71 beta-tester scenario suites / 0 failures
> - 75 bugs closed (BUG-1 through BUG-75), spec-driven with shipped-package proof
> - Durable evidence index: `.planning/dogfood-tusq-dev-evidence/DOGFOOD-EXTENDED-10-CYCLES-EVIDENCE-INDEX.md`

---

## Show HN Submission

**Title:** Show HN: AgentXchain – Open-source protocol where AI agents must challenge each other before code ships

**URL:** https://agentxchain.dev

**Comment (post immediately after submission):**

Hi HN, I've been building AgentXchain — an open-source governance protocol for multi-agent software delivery.

The problem: when you let multiple AI agents work on the same codebase, they tend to agree with each other, quality drifts, nobody owns decisions, and there's no way to tell what's actually shippable.

AgentXchain fixes this by treating multi-agent delivery as a governed system:

- Every agent turn MUST include at least one objection about the prior agent's work. Blind agreement is rejected.
- Humans approve phase transitions (planning -> implementation -> QA) and the ship decision.
- Phase gates enforce that real artifacts exist before work advances.
- Every decision goes into an append-only audit ledger.
- Works with any model or runtime: Claude Code, Cursor, direct API calls, MCP servers, or manual human turns.

The design borrows from institutional governance: the quality of collective output depends on the structure of disagreement, not the intelligence of participants.

**30-second demo (no API keys needed):**

```
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

This runs a complete governed lifecycle: PM scopes a feature, raises a risk. Dev implements and resolves the risk, raises a new one. QA reviews against acceptance criteria and raises a compliance gap. Three different perspectives, three different failure classes caught.

**What shipped by v2.155.73:**
- Structured recovery classification: recovery events now carry class, severity, actor action, and operator action metadata, and governance reports summarize recovery health from event history
- Crash-resume PID liveness guard: retained live worker PIDs are rejected before duplicate dispatch, while stale crash metadata is cleaned when recovery is proven
- Ghost blocker session checkpoint consistency and same-session active-run recovery for continuous mode
- Configurable per-turn deadlines from `per_turn_minutes`
- Restart-safe intent/event intake for continuous governed sessions
- Claude recovery hardening for retained auth failures, provider timeouts, Node incompatibility crashes, and refreshed credentials
- DOGFOOD credential smoke remains available as a direct shipped npx entrypoint for state-free diagnostics
- Perpetual continuous mode: `agentxchain run --continuous --on-idle perpetual` — vision-driven multi-run sessions that auto-chain through idle expansion, charter materialization, implementation, QA, and launch without human steering
- Parallel turns: run up to 4 agent turns concurrently within a governed run. Per-turn dispatch isolation prevents file races; acceptance is serialized. Proven with recorded runs.
- Delegation chains: a senior role delegates work to specialists, reviews their output, and decides next steps. Three-phase model: delegate → execute → review. Composes with parallel turns.
- Proven on real code: 10-cycle dogfood on tusq.dev produced 987 lines of real product code (src/, tests/) across 42 checkpoint commits under full governed autonomy
- 75 bugs closed across the beta cycle (BUG-1 through BUG-75), including ghost-turn auto-retry, operator-commit reconciliation, idle-expansion charter materialization, stale-run recovery, and approval-policy coupling
- All 5 adapters proven live (manual, local CLI, API proxy, MCP, remote_agent)
- `local_cli`, `api_proxy`, `mcp`, and `remote_agent` proven with real AI models; `manual` is the human-in-the-loop control path
- 108 conformance fixtures across 13 protocol surfaces
- Historical beta baseline: 7,078+ tests across 623 test files, including 71 beta-tester scenario suites with command-chain integration coverage
- Spec-driven: every bug fix has a spec in `.planning/`, acceptance tests, and shipped-package proof

**Architecture:**
1. Protocol (the constitution — run state, roles, turns, gates, decisions)
2. Runners (enforcement engines — CLI is the reference implementation)
3. Connectors (bridges to agent runtimes)
4. Workflow Kit (opinionated operating model for planning/specs/QA/release)
5. Integrations (dashboard, notifications, plugins, multi-repo)

MIT licensed. Protocol is the product. The CLI is one implementation.

- GitHub: https://github.com/shivamtiwari93/agentXchain.dev
- npm: https://www.npmjs.com/package/agentxchain
- Website: https://agentxchain.dev
- Docs: https://agentxchain.dev/docs/quickstart

Happy to answer questions about the architecture, the mandatory challenge design, or the evidence approach.

---

## Posting Instructions

1. Submit as "Show HN" with `https://agentxchain.dev`
2. Post the comment immediately after submission
3. Best times: Tuesday-Thursday, 10-11am ET. Next queued window: Wednesday 2026-04-29, 10-11am ET.
4. Be available to respond for at least 3 hours after posting
5. Expected questions to prepare for:
   - "How is this different from CrewAI/LangGraph?" → Those build agents. AgentXchain governs how they converge.
   - "Why not just use code review?" → Code review is post-hoc. Governed turns enforce challenge at every step.
   - "Does mandatory challenge slow things down?" → The demo runs in under 2 seconds. The overhead is structural, not temporal. And the 10-cycle dogfood proof shows the governed pipeline runs autonomously for hours.
   - "What models does it work with?" → Any model. Protocol is model-agnostic. Proven with Claude (Opus, Sonnet, Haiku), Codex, and any LLM API.
   - "How does this compare to A2A?" → A2A is agent-to-agent messaging. AgentXchain governs the delivery process — roles, charters, gates, challenges, and audit.
   - "`npx --yes -p agentxchain@latest -c "agentxchain demo"` says `unknown command 'demo'`" → This is usually npm resolving a stale global install first. Use `npx -p agentxchain@latest -c 'agentxchain demo'`.
   - "Has this been used on a real project?" → Yes. We dogfooded agentxchain on tusq.dev (a real product repo) — 10 governed runs, 987 lines of product code, zero human intervention. Evidence is public in `.planning/dogfood-tusq-dev-evidence/DOGFOOD-EXTENDED-10-CYCLES-EVIDENCE-INDEX.md`.
