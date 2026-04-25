# Spec: AgentXchain vs Devin Comparison Page

## Purpose

Public comparison page explaining how AgentXchain and Devin (by Cognition) differ in category, approach, and target problem. Must be honest about what Devin does well and clear about where AgentXchain's governed protocol model solves a different problem.

## Interface

- URL: `/compare/vs-devin`
- File: `website-v2/docs/compare/vs-devin.mdx`
- Navigation: navbar Compare dropdown, footer Product section, homepage comparison CTA row

## Behavior

- Frame Devin as an autonomous AI software engineer that can run managed Devin child sessions for large-scale tasks. Acknowledge its current strengths: Knowledge, Playbooks, DeepWiki, Ask Devin, managed parallel execution, Slack/Teams/Linear/Jira/GitHub/GitLab/Bitbucket/Datadog/VS Code-style IDE integration, cloud-based sandboxed environments, API v3, schedules, session insights, service-user RBAC, enterprise audit logs, and mid-session human intervention.
- Frame AgentXchain as a governed delivery protocol, not a competing coding agent. The products solve different problems: Devin makes one agent type very capable; AgentXchain governs how multiple heterogeneous roles converge on shippable software.
- Include a "using both together" section: Devin could be a connector/executor in an AgentXchain-governed workflow.
- Do not strawman Devin's parallel instances as inferior multi-agent. Be honest that parallel Devins can accomplish significant work — the gap is governed multi-role delivery, not capability or oversight.
- Do not deny Devin's audit/oversight surfaces (session event timelines, session insights, PR context, API, enterprise audit logs, and documented webhook-bridge automation patterns). The defensible boundary is: Devin provides single-agent-type oversight, not a multi-role delivery governance protocol with mandatory cross-role challenge.
- Public competitor claims must include official source links and a last-checked date.

## Error Cases

- Must not use stale phrases: `Fine-tunable to specific codebases`, `Human reviews PRs that Devin produces`, or any claim that Devin lacks audit/oversight surfaces entirely.
- Must not claim Devin has no human-in-the-loop: it has mid-session intervention, redirection, and team controls.
- Must not claim Devin has no API or automation surface.
- Must not use a fictional `devin --parallel` CLI example to prove managed Devin sessions. Use documented web/API framing or quote managed-Devins behavior from official docs.
- Must not present webhook automation as native Devin webhooks when the official docs describe webhook-bridge patterns that call the Devin API.

## Acceptance Tests

1. `AT-DEVIN-001`: Page builds without warnings in `cd website-v2 && npm run build`
2. `AT-DEVIN-002`: Page appears in navbar Compare dropdown, footer, and homepage CTA
3. `AT-DEVIN-003`: No claims about Devin that contradict its current documentation — must acknowledge Knowledge/Playbooks, session event timelines or insights, API/webhook-bridge automation, mid-session HITL, and team controls
4. `AT-DEVIN-004`: "Using both together" section exists and is honest
5. `AT-DEVIN-005`: Comparison table includes rows for Knowledge, Audit surface, and API/automation
6. `AT-DEVIN-006`: Stale phrases rejected: `Fine-tunable to specific codebases`, `Human reviews PRs that Devin produces`
7. `AT-DEVIN-CLAIMS-005`: Public comparison page exposes a source-baseline section with official Devin / Cognition source links and a last-checked date

## Sources

- Devin introduction: https://docs.devin.ai/get-started/devin-intro
- Advanced Capabilities: https://docs.devin.ai/work-with-devin/advanced-capabilities
- SDLC integration: https://docs.devin.ai/essential-guidelines/sdlc-integration
- Knowledge Onboarding: https://docs.devin.ai/onboard-devin/knowledge-onboarding
- Scheduled Sessions: https://docs.devin.ai/product-guides/scheduled-sessions
- API Overview: https://docs.devin.ai/api-reference/overview
- List Sessions API: https://docs.devin.ai/api-reference/v3/sessions/organizations-sessions
- Permissions & RBAC: https://docs.devin.ai/api-reference/v3/overview
- API release notes: https://docs.devin.ai/api-reference/release-notes
- Recent updates: https://docs.devin.ai/release-notes/overview
- Devin product page: https://devin.ai/

## Decision

- `DEC-DEVIN-COMPARE-WEBHOOK-BOUNDARY-001`: Public Devin comparison copy must not imply native Devin webhook event notifications unless official docs expose a native webhook surface. Use API / webhook-bridge wording for automation patterns that call Devin API endpoints from third-party webhook systems.
