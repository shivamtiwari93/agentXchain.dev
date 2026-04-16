# Spec: AgentXchain vs Devin Comparison Page

## Purpose

Public comparison page explaining how AgentXchain and Devin (by Cognition) differ in category, approach, and target problem. Must be honest about what Devin does well and clear about where AgentXchain's governed protocol model solves a different problem.

## Interface

- URL: `/compare/vs-devin`
- File: `website-v2/src/pages/compare/vs-devin.mdx`
- Navigation: navbar Compare dropdown, footer Product section, homepage comparison CTA row

## Behavior

- Frame Devin as an autonomous AI software engineer that can run parallel instances for large-scale tasks. Acknowledge its current strengths: Knowledge/Playbooks, parallel execution, Slack/Linear/GitHub/VS Code integration, cloud-based sandboxed environments, Devin Search, API/webhooks, session replay, team RBAC/SSO, and mid-session human intervention.
- Frame AgentXchain as a governed delivery protocol, not a competing coding agent. The products solve different problems: Devin makes one agent type very capable; AgentXchain governs how multiple heterogeneous roles converge on shippable software.
- Include a "using both together" section: Devin could be a connector/executor in an AgentXchain-governed workflow.
- Do not strawman Devin's parallel instances as inferior multi-agent. Be honest that parallel Devins can accomplish significant work — the gap is governed multi-role delivery, not capability or oversight.
- Do not deny Devin's audit/oversight surfaces (session replay, action logs, API, webhooks). The defensible boundary is: Devin provides single-agent-type oversight, not a multi-role delivery governance protocol with mandatory cross-role challenge.

## Error Cases

- Must not use stale phrases: `Fine-tunable to specific codebases`, `Human reviews PRs that Devin produces`, or any claim that Devin lacks audit/oversight surfaces entirely.
- Must not claim Devin has no human-in-the-loop: it has mid-session intervention, redirection, and team controls.
- Must not claim Devin has no API or automation surface.

## Acceptance Tests

1. `AT-DEVIN-001`: Page builds without warnings in `cd website-v2 && npm run build`
2. `AT-DEVIN-002`: Page appears in navbar Compare dropdown, footer, and homepage CTA
3. `AT-DEVIN-003`: No claims about Devin that contradict its current documentation — must acknowledge Knowledge/Playbooks, session replay, API/webhooks, mid-session HITL, and team controls
4. `AT-DEVIN-004`: "Using both together" section exists and is honest
5. `AT-DEVIN-005`: Comparison table includes rows for Knowledge, Audit surface, and API/automation
6. `AT-DEVIN-006`: Stale phrases rejected: `Fine-tunable to specific codebases`, `Human reviews PRs that Devin produces`
