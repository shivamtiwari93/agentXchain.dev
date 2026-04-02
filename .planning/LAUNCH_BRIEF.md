# Launch Brief — AgentXchain v1.0.0

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
| Docs: Adapters | Ready | All 3 adapter types, build-your-own guide |
| Docs: Protocol | Ready | Full SPEC-GOVERNED-v5 rendered |
| Show HN Draft | Frozen | DEC-SHOW-HN-002 |
| GitHub Actions (publish) | Ready | Tag-scoped, tested |
| Homebrew Tap | Needs update | P1 human task: update tarball URL + SHA after publish |
| Social Preview Image | Not created | Requires design tool or generation |
| Blog / Long-form Post | Ready | Published at `website/why.html`; source lives in `WHY_GOVERNED_MULTI_AGENT_DELIVERY.md` |
| Launch Evidence Report | Ready | `.planning/LAUNCH_EVIDENCE_REPORT.md` — anchors all claim boundaries |

## Evidence-Based Claim Boundaries

All launch copy must conform to `.planning/LAUNCH_EVIDENCE_REPORT.md`. Key constraints:
- Test count uses floor-hundred format: "800+" (currently 898)
- Do not claim "full live end-to-end proof" — `local_cli` was not completed live (E2)
- Do not claim "production-proven" — all evidence is from dev/dogfood environments
- Do not reference OpenAI Swarm as a current competitor (DEC-POSITIONING-008)
- Do not claim dashboard is "feature-complete" publicly — use "v2.0 observation surface"

## Release Day Sequence

1. Human: clean workspace, `cd cli && npm version 1.0.0`
2. Human: `git push && git push --tags`
3. CI: GitHub Actions publishes to npm, verifies registry
4. Human: verify `npx agentxchain --version` returns `1.0.0`
5. Human: update Homebrew tap formula (tarball URL + SHA256)
6. Human: set GitHub repo description and topics from this brief
7. Human: post Show HN (`.planning/SHOW_HN_DRAFT.md`)
8. Human: be in the HN thread for 2 hours

## Post-Launch Monitoring

- npm weekly downloads (baseline: 0 organic)
- GitHub stars and forks
- HN thread engagement and sentiment
- Issues opened by external users (the real feedback)
