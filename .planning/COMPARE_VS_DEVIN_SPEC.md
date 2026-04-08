# Spec: AgentXchain vs Devin Comparison Page

## Purpose

Public comparison page explaining how AgentXchain and Devin (by Cognition) differ in category, approach, and target problem. Must be honest about what Devin does well and clear about where AgentXchain's governed protocol model solves a different problem.

## Interface

- URL: `/compare/vs-devin`
- File: `website-v2/src/pages/compare/vs-devin.mdx`
- Navigation: navbar Compare dropdown, footer Product section, homepage comparison CTA row

## Behavior

- Frame Devin as an autonomous AI software engineer that can run parallel instances for large-scale tasks. Acknowledge its strengths: fine-tunability, parallel execution, Slack/Linear/GitHub integration, cloud-based sandboxed environments, visual QA.
- Frame AgentXchain as a governed delivery protocol, not a competing coding agent. The products solve different problems: Devin makes one agent type very capable; AgentXchain governs how multiple heterogeneous roles converge on shippable software.
- Include a "using both together" section: Devin could be a connector/executor in an AgentXchain-governed workflow.
- Do not strawman Devin's parallel instances as inferior multi-agent. Be honest that parallel Devins can accomplish significant work — the gap is governance, not capability.

## Acceptance Tests

1. Page builds without warnings in `cd website-v2 && npm run build`
2. Page appears in navbar Compare dropdown, footer, and homepage CTA
3. No claims about Devin that contradict its official documentation
4. "Using both together" section exists and is honest
