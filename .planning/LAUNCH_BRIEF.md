# Launch Brief — AgentXchain

> Single-source launch copy for all distribution surfaces.

---

## One-Paragraph Product Description

AgentXchain is an open-source protocol and CLI for governed multi-agent software delivery. Multiple AI agents work on the same codebase under constitutional rules: every turn must include a structured objection, the protocol requires human approval at phase transitions and ship decisions, and every contribution is recorded in an append-only audit trail. The protocol is model-agnostic — manual turns, local CLI agents (Claude Code, Codex, Aider), and API-backed agents all run under the same governance rules. The result is convergence quality: code that has been challenged from multiple perspectives, with evidence for why it should ship.

## One-Sentence Repo Description

Governed multi-agent software delivery — agents required to challenge each other, protocol-enforced human gates, append-only audit trail.

## GitHub Topics

```
ai-agents
multi-agent
governance
software-delivery
developer-tools
cli
protocol
code-review
audit-trail
sdlc
orchestrator
open-source
```

## npm Package Short Description

Current (`cli/package.json`): "CLI for AgentXchain — governed multi-agent software delivery"

**No change needed.** This is accurate and concise for `npm search` results.

## GitHub Repository Description (Settings → About)

```
Governed multi-agent software delivery. Agents required to challenge each other. Human gates. Append-only audit trail. Model-agnostic protocol + CLI.
```

## Social Preview Image Copy

**Headline:** Governed Multi-Agent Software Delivery

**Subheadline:** Agents challenge each other. Humans gate the ship decision. Every turn leaves an audit trail.

**Tagline (bottom):** agentxchain.dev · Open Source · MIT

## npm Keywords (current)

Current keywords in `package.json` are adequate:
`ai`, `agents`, `multi-agent`, `coordination`, `sdlc`, `governance`, `orchestrator`, `protocol`, `claude-code`, `agentxchain`

**Recommended additions:** `code-review`, `audit-trail`, `developer-tools`, `adversarial-collaboration`

## Launch Surfaces Checklist

| Surface | Status | Notes |
|---------|--------|-------|
| Website (agentxchain.dev) | Ready | Hero, docs, positioning aligned |
| GitHub README | Ready | DEC-README-001 applied |
| npm README (cli/README.md) | Ready | DEC-README-001 applied |
| Docs: Quickstart | Ready | Reproducible scaffold path, QA dependency disclosed |
| Docs: CLI Reference | Ready | All governed commands documented |
| Docs: Adapters | Ready | All 4 adapter types, build-your-own guide |
| Docs: Plugins | Ready | Plugin authoring, install/list/upgrade/remove, config enforcement, rollback semantics |
| Docs: Protocol | Ready | Protocol v6 published; v5 remains historical reference |
| Show HN Draft | Frozen | DEC-SHOW-HN-002 |
| GitHub Actions (publish) | Ready | Tag-scoped, tested |
| Homebrew Tap | Ready | Canonical tap is on the live release; workflow sync + graceful PR fallback shipped |
| Social Preview Image | Not created | Requires design tool or generation |
| Blog / Long-form Post | Ready | Published at `website-v2/src/pages/why.mdx`; source lives in `WHY_GOVERNED_MULTI_AGENT_DELIVERY.md` |
| Launch Evidence Report | Ready | `.planning/LAUNCH_EVIDENCE_REPORT.md` — anchors all claim boundaries |

## Evidence-Based Claim Boundaries

All launch copy must conform to `.planning/LAUNCH_EVIDENCE_REPORT.md`. Key constraints:
- Test count uses the floor-hundred format from `.planning/LAUNCH_EVIDENCE_REPORT.md`. Do not invent a higher number than the evidence artifact currently supports in public copy.
- All four adapter types are now proven live, including MCP with a real Anthropic model (`E2`, `E2b`, `E2b+`). The honest narrower boundary is lifecycle depth: only the `manual` + `local_cli` + `api_proxy` path has a full governed-run proof including human-gated completion approval.
- `api_proxy` proposed-authority full lifecycle including run completion is now proven live against real Anthropic (E2c, `run_7b067f892916b799`). The previous disallowed claim (`DEC-PROP-COMPLETION-CONTRACT-001`) is closed: the product contract bug was fixed in Turn 133, and the hardened live proof passed on 2026-04-08 with gate-valid proposal content, no-op completion, `pending_run_completion` pause, and `approve-completion`
- Do not claim "production-proven" — all evidence is from dev/dogfood environments
- Do not reference OpenAI Swarm as a current competitor (DEC-POSITIONING-008)
- Do not claim dashboard is "feature-complete" publicly — use "v2.0 observation surface"

## Release Day Sequence

1. Agent: run strict preflight against the exact release ref in a clean checkout/worktree.
2. Agent: create release identity with `npm run bump:release -- --target-version <target>` only when the target changelog entry and proof surface are already green.
3. Agent: push the release commit and tag; GitHub Actions publishes to npm and verifies registry visibility.
4. Agent: verify `npm view agentxchain@<target>` and `npm exec --yes --package=agentxchain@<target> -- agentxchain --version`.
5. Agent: update the Homebrew tap formula to the published npm tarball URL + SHA256.
6. Agent: create/update the GitHub release metadata and distribution copy.
7. Agent: publish the prepared marketing copy to the allowed channels.

If a public tag points to a broken release payload, do not force-move it. Cut the next corrective version instead.

## Post-Launch Monitoring

- npm weekly downloads (baseline: 0 organic)
- GitHub stars and forks
- HN thread engagement and sentiment
- Issues opened by external users (the real feedback)
