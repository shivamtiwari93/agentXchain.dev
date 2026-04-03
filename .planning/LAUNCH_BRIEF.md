# Launch Brief — AgentXchain v2.0.1

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
| Docs: Plugins | Ready | Plugin authoring, install/list/remove, manifest format, failure modes |
| Docs: Protocol | Ready | Protocol v6 published; v5 remains historical reference |
| Show HN Draft | Deferred | Hacker News posting is intentionally skipped for now |
| GitHub Actions (publish) | Ready | Tag-scoped, tested |
| Homebrew Tap | Needs update | P1 human task: update tarball URL + SHA after publish |
| Social Preview Image | Not created | Requires design tool or generation |
| Blog / Long-form Post | Ready | Published at `website/why.html`; source lives in `WHY_GOVERNED_MULTI_AGENT_DELIVERY.md` |
| Launch Evidence Report | Ready | `.planning/LAUNCH_EVIDENCE_REPORT.md` — anchors all claim boundaries |

## Evidence-Based Claim Boundaries

All launch copy must conform to `.planning/LAUNCH_EVIDENCE_REPORT.md`. Key constraints:
- Test count uses floor-hundred format: "900+" (currently 960)
- Do not claim "full live end-to-end proof" — `local_cli` was not completed live (E2)
- Do not claim "production-proven" — all evidence is from dev/dogfood environments
- Do not reference OpenAI Swarm as a current competitor (DEC-POSITIONING-008)
- Do not claim dashboard is "feature-complete" publicly — use "v2.0 observation surface"

## Release Day Sequence

1. Human: restore npm publish authorization by either authorizing trusted publishing for `.github/workflows/publish-npm-on-tag.yml` or regenerating the invalid `NPM_TOKEN` in `.env` and GitHub Actions secrets
2. AI: retrigger `publish-npm-on-tag.yml` for `v2.0.1`
3. AI: confirm the workflow completes publish plus `release-postflight.sh`, then rerun `cd cli && bash scripts/release-postflight.sh --target-version 2.0.1` locally for independent verification
4. AI: verify `npm exec --yes --package agentxchain@2.0.1 -- agentxchain --version` returns `2.0.1`
5. AI: update the Homebrew tap formula (tarball URL + SHA256) after postflight passes
6. AI: publish the GitHub release and set repo description/topics from this brief
7. Human: post the prepared Reddit copy if desired; Hacker News remains skipped for now

## Post-Launch Monitoring

- npm weekly downloads (baseline: 0 organic)
- GitHub stars and forks
- Reddit engagement and sentiment
- Issues opened by external users (the real feedback)
