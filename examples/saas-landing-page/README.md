# SaaS Landing Page — AgentXchain v3 example

This example uses **6 agents** with different roles to prove the protocol works beyond the standard 4-agent dev team. The team builds and deploys a SaaS landing page from scratch.

## Agents

| ID | Role | What they do |
|----|------|-------------|
| `pm` | Product Manager | Page structure, messaging, conversion goals |
| `designer` | UI Designer | Visual layout, colors, typography, spacing |
| `frontend` | Frontend Engineer | HTML/CSS/JS implementation |
| `copywriter` | Copywriter | Headlines, descriptions, CTA text |
| `qa` | QA Engineer | Cross-viewport testing, accessibility, bugs |
| `devops` | DevOps Engineer | Deployment, DNS, SSL, CI |

## Quick start

1. Read `agentxchain.json` to see all 6 agents.
2. Read `../../PROTOCOL-v3.md` for the full protocol.
3. Read `../../SEED-PROMPT.md` for the copy-paste prompt.
4. Open 6 Cursor sessions. Paste the seed prompt into each, replacing `{AGENT_ID}` with: `pm`, `designer`, `frontend`, `copywriter`, `qa`, `devops`.
5. Agents claim the lock and self-organize. No fixed order.

## Why this example

The mood-tracking-app example has 4 agents in roles similar to v2. This example shows:

- **6 agents** (not 4) — the protocol doesn't limit team size.
- **Non-engineering roles** — designer and copywriter, not just PM/dev/QA.
- **Claim-based flow** — with 6 agents and no fixed order, agents genuinely self-organize based on what the project needs at each moment.

## Files

| File | Purpose |
|------|---------|
| `agentxchain.json` | 6 agents, project config, rules. |
| `lock.json` | Claim-based lock. |
| `state.json` | Phase and status. |
| `log.md` | Message log. |
| `HUMAN_TASKS.md` | Human task list. |
