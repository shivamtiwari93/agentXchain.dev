# Spec: MetaGPT Comparison Claim Boundary

## Purpose

Freeze the public truth boundary for `AgentXchain vs MetaGPT`.

MetaGPT is the closest philosophical competitor because it also uses structured multi-agent collaboration, role assignment, and SOP-style orchestration. The comparison must acknowledge MetaGPT's current framework and product surfaces honestly, then keep the product contrast on what MetaGPT still does not ship: a repository-delivery constitution with mandatory challenge, explicit phase gates, and an append-only delivery decision ledger.

## Interface

- URL: `/compare/vs-metagpt`
- File: `website-v2/src/pages/compare/vs-metagpt.mdx`
- Navigation: navbar Compare dropdown, footer Product section, homepage comparison CTA row

## Behavior

- Frame MetaGPT as a multi-agent framework with:
  - software-company SOPs
  - custom team and environment abstractions
  - publish-subscribe agent communication (`_watch`/`cause_by`, Environment as message broker)
  - specialist agents such as Data Interpreter and Researcher
  - `is_human=True` HITL role conversion with terminal input
  - memories plus serialization / breakpoint recovery (`team.json` state, `--recover_path`, action-index resume)
  - incremental development via `--project-path` for iterating on existing codebases
  - the hosted Atoms product (formerly MGX / MetaGPT X)
- Do not collapse MetaGPT into a frozen `PM/Architect/Engineer/QA only` story. The page must acknowledge framework extensibility and current product breadth.
- Do not reduce MetaGPT to "greenfield-only generation." The `--project-path` incremental development feature enables iterating on existing projects with new requirements and bug fixes.
- Do not conflate the MetaGPT paper with later DeepWisdom/FoundationAgents research. The comparison may cite MetaGPT (ICLR 2024) and AFlow (ICLR 2025 oral), but it must not falsely imply that `MetaGPT itself is the ICLR 2025 oral paper`.
- Public comparison page must include a `Source baseline` section with official MetaGPT source links and a last-checked date, following the pattern established for CrewAI, LangGraph, OpenAI Agents SDK, AG2, and Devin comparisons.
- Frame AgentXchain as a protocol-first governed delivery system. The durable contrast is:
  - arbitrary chartered roles
  - mandatory cross-role challenge
  - explicit phase gates
  - append-only delivery decision ledger
  - constitutional human authority
  - repository-delivery governance instead of app-owned orchestration
- Be honest about the overlap: both assign agents to software roles, use structure, and can be combined.
- Include a "using both together" section if honest.

## Error Cases

- Do not claim MetaGPT roles are simply `Fixed: Product Manager, Architect, Engineer, QA`.
- Do not reduce MetaGPT human authority to `User provides the initial requirement`.
- Do not claim MetaGPT recovery is `Restart the pipeline`.
- Do not describe MetaGPT as merely `Optimized for single-pass generation`.
- Do not use `MGX at mgx.dev` as the only hosted-product wording without acknowledging the current `Atoms` naming.
- Do not claim `ICLR 2025 oral paper` as if it refers to MetaGPT itself.

## Acceptance Tests

1. `AT-METAGPT-CLAIMS-001`: `website-v2/src/pages/compare/vs-metagpt.mdx` explicitly acknowledges Data Interpreter, Researcher, custom-role or environment abstractions, and `Atoms (formerly MGX / MetaGPT X)`.
2. `AT-METAGPT-CLAIMS-002`: the page acknowledges serialization / breakpoint recovery or equivalent scoped recovery wording; it must not say recovery is restart-only.
3. `AT-METAGPT-CLAIMS-003`: the page distinguishes MetaGPT (ICLR 2024) from AFlow (ICLR 2025 oral) instead of collapsing them into one stale claim.
4. `AT-METAGPT-CLAIMS-004`: the page keeps the contrast on missing repository-delivery governance, mandatory challenge, explicit phase gates, and append-only delivery decisions.
5. `AT-METAGPT-CLAIMS-005`: the public comparison page exposes official MetaGPT source links (GitHub README, docs home, MultiAgent 101, human engagement, agent communication, breakpoint recovery, incremental development, Data Interpreter, Researcher, Atoms) and a last-checked date.
6. `AT-METAGPT-CLAIMS-006-BUILD`: `cd website-v2 && npm run build` succeeds.

## Open Questions

- If MetaGPT / Atoms keeps expanding into deployment, observability, or explicit approval surfaces, do we eventually need a long-form docs comparison page instead of only the short compare page?
