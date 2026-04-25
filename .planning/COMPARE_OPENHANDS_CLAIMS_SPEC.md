# OpenHands Comparison Claims Spec

## Purpose

Freeze the truth boundary for public AgentXchain vs OpenHands comparison surfaces so they stay current with OpenHands' real product shape and do not drift back to stale shorthand.

## Interface

Single short comparison page: `website-v2/docs/compare/vs-openhands.mdx`. No long-form doc.

## Behavior

The comparison page must acknowledge current official OpenHands capabilities where primary sources explicitly provide them:

- **SDK**: Composable Python SDK with Agents, Tools, Conversations, Skills (not stale "micro-agents")
- **CLI**: Claude Code / Codex-like CLI experience
- **GUI**: Local React GUI with REST API
- **Cloud**: Hosted platform with Slack/Jira/Linear integrations, multi-user, RBAC/permissions, collaboration
- **Enterprise**: Self-hosted/private-cloud deployment in VPC via Kubernetes, BYO LLM, SAML/SSO, GitHub Enterprise/GitLab/Bitbucket, Jira, Slack, containerized sandbox runtime, auditability, and multi-user RBAC
- **Runtime / workspace**: Docker sandbox runtime plus local, Docker, and remote API workspace abstractions
- **Agent Server**: HTTP/WebSocket API for remote execution, workspace isolation, container orchestration, multi-user systems, horizontal scaling, Kubernetes deployment, metrics, and client SDK
- **Skills marketplace**: Public skills via `AgentContext(load_public_skills=True)`
- **MCP support**: Built into SDK and CLI `openhands mcp` command surface
- **Chrome extension**: Exists as separate repo
- **Benchmarks**: Official benchmark harness covers SWE-Bench, GAIA, Commit0, and OpenAgentSafety. Do not freeze an exact OpenHands score unless a current official source exposes it plainly.
- **Sources**: Public comparison page must include a source-baseline section with official OpenHands source links and a last-checked date.

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
- Hard-coded `SWE-Bench 77.6%` score unless a current official source exposes that exact result plainly
- Enterprise integration wording that implies Linear is named by Enterprise docs. Linear is source-backed from the Cloud README; Enterprise docs separately name SAML/SSO, GitHub Enterprise/GitLab/Bitbucket, Jira, and Slack.

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
- `AT-OH-013`: Page exposes official source links and a last-checked date; spec references this acceptance test
- `AT-OH-014`: Page does not freeze an unsupported `SWE-Bench 77.6%` score

## Sources

- OpenHands GitHub README: https://github.com/OpenHands/OpenHands
- OpenHands Software Agent SDK README: https://github.com/OpenHands/software-agent-sdk/
- Software Agent SDK docs: https://docs.openhands.dev/sdk
- SDK package architecture: https://docs.openhands.dev/sdk/arch/sdk
- Agent Server package: https://docs.openhands.dev/sdk/arch/agent-server
- Remote Agent Server overview: https://docs.openhands.dev/sdk/guides/agent-server/overview
- CLI command reference: https://docs.openhands.dev/openhands/usage/cli/command-reference
- Cloud CLI docs: https://docs.openhands.dev/openhands/usage/cli/cloud
- Enterprise docs: https://docs.openhands.dev/enterprise
- Runtime architecture: https://docs.openhands.dev/openhands/usage/architecture/runtime
- OpenHands benchmarks repo: https://github.com/OpenHands/benchmarks

## Decisions

- `DEC-OPENHANDS-COMPARE-BENCHMARK-SCORE-001`: Public OpenHands comparison copy must not freeze an exact SWE-Bench percentage unless a current official source exposes that exact score plainly. Use the official benchmark-harness scope instead.

## Open Questions

- None. All claims are backed by current primary sources listed above.
