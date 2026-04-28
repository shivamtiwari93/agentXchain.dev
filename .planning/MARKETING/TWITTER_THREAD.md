# Twitter/X Thread — AgentXchain v2.155.60

> Ready-to-post thread for the `v2.155.60` release. Updated 2026-04-28 for BUG-105 fix: strict intent coverage now reads normalized evidence summaries and punctuation-normalized acceptance text.
>
> Aggregate evidence:
> - node --test --test-timeout=60000 cli/test/compare-crewai-claims.test.js cli/test/compare-langgraph-claims.test.js cli/test/compare-openai-agents-sdk-claims.test.js cli/test/compare-autogen-claims.test.js cli/test/compare-devin-claims.test.js cli/test/compare-metagpt-claims.test.js cli/test/compare-openhands-claims.test.js cli/test/compare-codegen-claims.test.js cli/test/compare-warp-claims.test.js cli/test/comparison-pages-content.test.js cli/test/compare-page-architecture.test.js -> 98 tests / 11 suites / 0 failures / 0 skipped
> - node --test --test-timeout=120000 cli/test/agent-talk-word-cap.test.js cli/test/current-release-surface.test.js -> 31 tests / 2 suites / 0 failures / 0 skipped
> - npm test -- --test-timeout=60000 -> 7314 tests / 1483 suites / 0 failures / 5 skipped

---

## Thread

**Tweet 1 (hook):**

Most multi-agent AI coding demos: three agents agree with each other, dump a diff, nobody can explain why it should ship.

We built the opposite: agents are REQUIRED to challenge each other. Blind agreement is rejected by the orchestrator.

AgentXchain v2.155.60 ships BUG-105 fix: strict intent coverage now sees normalized verification evidence summaries, so full-auto recovery can keep moving without staging edits. Open source. MIT.

**Tweet 2 (30-second demo):**

See it work in 30 seconds. No API keys:

```
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

PM scopes auth-token rotation, raises a missing-rollback risk.
Dev implements, resolves it, raises clock-skew.
QA reviews, raises a compliance gap.

3 agents. 3 different failure classes caught. 1.8 seconds.

**Tweet 3 (how it works):**

How it works:

- PM plans -> Dev builds -> QA reviews
- Every turn MUST include an objection about the prior work
- Human approves phase transitions and the final ship decision
- Phase gates enforce real artifacts before work advances
- Every decision goes into an append-only audit trail

The orchestrator enforces the rules. It doesn't make decisions.

**Tweet 4 (real proof):**

All 5 adapter types proven live:

- manual (human-in-the-loop control path)
- local_cli (Claude Code, any CLI agent, proven with a real model)
- api_proxy (direct LLM API with proposal staging, proven with a real model)
- MCP (stdio + streamable HTTP with Anthropic API)
- remote_agent (HTTP bridge, proven live and with real-model output)

`local_cli`, `api_proxy`, `mcp`, and `remote_agent` have real-model proof. `manual` is the governed human control path.

New in v2.155.60:

- Strict intent coverage searches `verification.evidence_summary` after staged-result normalization.
- Acceptance matching now tokenizes word characters, so punctuation does not hide explicit bounded/testable/non-duplicate proof.
- Missing acceptance proof still fails closed.
- Targeted proof: node --test --test-timeout=120000 cli/test/beta-tester-scenarios/bug-105-intent-coverage-structured-evidence.test.js cli/test/beta-tester-scenarios/bug-104-structured-machine-evidence-normalization.test.js cli/test/beta-tester-scenarios/bug-103-decision-title-statement-normalization.test.js -> 7 tests / 3 suites / 0 failures.
- 108 conformance fixtures across 13 protocol surfaces.

**Tweet 5 (the insight):**

The insight from institutional design:

The quality of collective output depends on the STRUCTURE of disagreement, not the intelligence of participants.

Same reason code review exists for human teams.
Same reason adversarial legal systems outperform inquisitorial ones.

**Tweet 6 (positioning):**

AgentXchain is NOT:
- An agent framework (CrewAI, LangGraph, AutoGen)
- A coding assistant (Devin, Cursor, Copilot)
- A message router (A2A)
- A tool connector (MCP)

It's the governance layer BETWEEN agents. They can be built with anything. We govern how they converge.

**Tweet 7 (CTA):**

Try it:
```
npx --yes -p agentxchain@latest -c "agentxchain demo"
```

Then scaffold your own:
```
npx --yes -p agentxchain@latest -c "agentxchain init --governed"
```

GitHub: github.com/shivamtiwari93/agentXchain.dev
Docs: agentxchain.dev/docs/quickstart
npm: npmjs.com/package/agentxchain

If npm resolves a stale global install first, run:
`npx --yes -p agentxchain@latest -c "agentxchain demo"`

---

## Posting Notes

- Post during US working hours (10-11am ET, Tue-Thu)
- Space tweets 2-3 minutes apart
- Pin the thread to profile
- Quote-tweet Tweet 1 with any interesting reply threads
- Lead with the demo — `npx --yes -p agentxchain@latest -c "agentxchain demo"` is the strongest hook
