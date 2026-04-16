# OpenHands Comparison Claims Spec

## Purpose

Freeze the truth boundary for public AgentXchain vs OpenHands comparison surfaces so they stay current with OpenHands' real product shape and do not drift back to stale shorthand.

## Interface

Single short comparison page: `website-v2/src/pages/compare/vs-openhands.mdx`. No long-form doc.

## Behavior

The comparison page must acknowledge current official OpenHands capabilities where primary sources explicitly provide them:

- **SDK**: Composable Python SDK with Agents, Tools, Conversations, Skills (not stale "micro-agents")
- **CLI**: Claude Code / Codex-like CLI experience
- **GUI**: Local React GUI with REST API
- **Cloud**: Hosted platform with Slack/Jira/Linear integrations, multi-user, RBAC/permissions, collaboration
- **Enterprise**: Self-hosted in VPC via Kubernetes, source-available
- **Runtime**: Docker, Remote, Modal, Runloop implementations with plugin system
- **Agent Server**: REST API for ephemeral workspaces, WebSocket connections, scales to thousands
- **Skills marketplace**: Public skills via `AgentContext(load_public_skills=True)`
- **MCP support**: Built into SDK
- **Chrome extension**: Exists as separate repo
- **SWE-Bench**: 77.6% score

The product contrast must stay on:

- Missing repository-delivery governance protocol
- No mandatory cross-role challenge
- No explicit phase gates with constitutional human authority
- No append-only decision ledger for delivery decisions
- No cross-repo coordinator semantics

## Error Cases

The page must NOT contain:

- `micro-agents` as a current product term (stale; replaced by SDK composable agents)
- `from openhands import Agent, Sandbox` (stale import; current is `from openhands.sdk import ...`)
- Claims that OpenHands is only self-hostable (Cloud and Enterprise tiers exist)
- Claims that human authority is only "user-configurable within agent behavior" without acknowledging Cloud RBAC
- `air-gapped` as OpenHands' only enterprise story (Enterprise K8s in VPC is the current surface)

## Acceptance Tests

- `AT-OH-001`: Page acknowledges composable SDK (not "micro-agents")
- `AT-OH-002`: Page acknowledges CLI product surface
- `AT-OH-003`: Page acknowledges Cloud with RBAC
- `AT-OH-004`: Page acknowledges Enterprise Kubernetes deployment
- `AT-OH-005`: Page acknowledges Slack/Jira/Linear integrations
- `AT-OH-006`: Page acknowledges Agent Server scaling
- `AT-OH-007`: Code example uses current SDK import path (`from openhands.sdk`)
- `AT-OH-008`: Page does not contain stale "micro-agents" term
- `AT-OH-009`: Page does not contain stale `from openhands import Agent, Sandbox`

## Open Questions

- None. All claims are backed by current primary sources (GitHub README, SDK README, runtime README).
