# Spec: AgentXchain vs MetaGPT Comparison Page

## Purpose

Public comparison page explaining how AgentXchain and MetaGPT differ. MetaGPT is the closest philosophical competitor — it also assigns agents to software company roles and governs them through SOPs. The comparison must acknowledge this overlap honestly and clarify the real differences.

## Interface

- URL: `/compare/vs-metagpt`
- File: `website-v2/src/pages/compare/vs-metagpt.mdx`
- Navigation: navbar Compare dropdown, footer Product section, homepage comparison CTA row

## Behavior

- Frame MetaGPT as a multi-agent software development framework that models a software company with roles (PM, architect, engineer) governed by Standard Operating Procedures. Acknowledge: structured role-based collaboration, SOP governance, code generation from requirements, ICLR 2025 paper, MGX hosted product.
- Frame AgentXchain as a protocol-first governed delivery system. Key differences: AgentXchain is a protocol (not a framework), supports arbitrary chartered roles (not fixed PM/architect/engineer), has mandatory cross-role challenge, append-only decision ledger, explicit phase gates, and constitutional human authority.
- Acknowledge MetaGPT's strengths: research-backed, battle-tested SOP pipeline, faster for greenfield generation from a single requirement.
- Be honest about the overlap: both assign agents to software roles and enforce structure. The difference is protocol vs framework, arbitrary roles vs fixed roles, delivery governance vs generation pipeline.
- Include a "using both together" section if honest.

## Acceptance Tests

1. Page builds without warnings in `cd website-v2 && npm run build`
2. Page appears in navbar Compare dropdown, footer, and homepage CTA
3. No claims about MetaGPT that contradict its official documentation
4. Overlap is honestly acknowledged, not minimized
