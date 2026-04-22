# Hacker News Submission — AgentXchain v2.154.3

> Ready-to-post for the `v2.154.3` launch window once tester verification lands. Updated 2026-04-22 for the BUG-61 ghost-retry quote-back and diagnostic-surface patch over `v2.154.1` (strict auto-retry preconditions, explicit opt-in docs, and self-contained `attempts_log` stderr/exit fields).
>
> Aggregate evidence:
> - node --test --test-timeout=60000 test/ghost-retry.test.js test/continuous-run.test.js test/continuous-ghost-retry-e2e.test.js test/bug-61-tester-runbook-content.test.js test/lights-out-operation-guide-content.test.js -> 106 tests / 30 suites / 0 failures / 0 skipped

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

**What's queued in v2.149.1:**
- BUG-54 Claude auth preflight: `local_cli` Claude runtimes now fail before spawn when neither env auth nor `--bare` is present, using the same `claude_auth_preflight_failed` contract across adapter dispatch, `connector check`, and `connector validate`
- BUG-54 operator diagnostics stay shipped: `process_exit` forensic fields, reproduction harness + runbook, per-runtime watchdog override, and truthful stderr-only rendering
- BUG-52 four-lane reconciler coverage shipped for planning, QA, Turn 93 orphan-request, and Turn 94 queued-transition recovery
- BUG-55 wrong-lineage checkpoint surfacing + `undeclared_verification_outputs` rejection stay in the release lane
- BUG-53 continuous auto-chain and `idle_exit` proof stay in the release lane
- BUG-54, BUG-52, BUG-55, and BUG-53 remain open pending tester verification on `v2.149.1`
- All 5 adapters proven live (manual, local CLI, API proxy, MCP, remote_agent)
- `local_cli`, `api_proxy`, `mcp`, and `remote_agent` proven with real AI models; `manual` is the human-in-the-loop control path
- 108 conformance fixtures across 13 protocol surfaces
- node --test cli/test/beta-tester-scenarios/ → 172 tests / 64 suites / 0 failures
- node --test cli/test/claim-reality-preflight.test.js → 42 tests / 1 suite / 0 failures

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
3. Best times: Tuesday-Thursday, 10-11am ET
4. Be available to respond for at least 3 hours after posting
5. Expected questions to prepare for:
   - "How is this different from CrewAI/LangGraph?" → Those build agents. AgentXchain governs how they converge.
   - "Why not just use code review?" → Code review is post-hoc. Governed turns enforce challenge at every step.
   - "Does mandatory challenge slow things down?" → The demo runs in 1.8s. The overhead is structural, not temporal.
   - "What models does it work with?" → Any model. Protocol is model-agnostic. Proven with Claude, works with any LLM API.
   - "How does this compare to A2A?" → A2A is agent-to-agent messaging. AgentXchain governs the delivery process.
   - "`npx --yes -p agentxchain@latest -c "agentxchain demo"` says `unknown command 'demo'`" → This is usually npm resolving a stale global install first. Use `npx -p agentxchain@latest -c 'agentxchain demo'`.
