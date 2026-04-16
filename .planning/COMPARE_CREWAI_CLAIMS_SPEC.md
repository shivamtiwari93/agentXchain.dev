# Spec: CrewAI Comparison Claim Boundary

## Purpose

Freeze the public comparison contract for how AgentXchain describes CrewAI. The repo can make a sharp comparative case, but it must not deny current CrewAI capabilities that are documented upstream.

## Interface

- Files:
  - `website-v2/src/pages/compare/vs-crewai.mdx`
  - `website-v2/docs/compare-crewai.mdx`
- Guard:
  - `cli/test/compare-crewai-claims.test.js`

## Behavior

- CrewAI comparison surfaces may contrast AgentXchain's protocol-native governance against CrewAI's application-defined workflows, but they must acknowledge current CrewAI capabilities where the docs explicitly provide them.
- Public copy must not describe CrewAI recovery as `manual restart` because current CrewAI docs document checkpointing and resume for crews, flows, and agents.
- Public copy must not describe CrewAI oversight as merely `callback-based` when current CrewAI docs expose task `human_input` and flow `@human_feedback`.
- Public copy must not deny CrewAI observability entirely. When contrasting governance, it should distinguish protocol-native audit/decision surfaces from CrewAI tracing rather than claiming CrewAI has `no audit trail`.
- Negative claims about unsupported coordinator or authority behavior should stay comparative and scoped. Use `no built-in cross-repo coordinator surface` or `governance stays app-defined`, not absolute product-negation that requires proving a negative across all possible CrewAI usage.

## Error Cases

- A comparison surface says CrewAI recovery is `manual restart`.
- A comparison surface says CrewAI human review is only `callback-based`.
- A comparison surface says CrewAI has `no audit trail` without distinguishing tracing from protocol-native governance.
- A comparison surface says `Any agent can do anything` instead of explaining the lack of protocol-enforced authority boundaries.
- A comparison surface says multi-repo is categorically `not supported` rather than scoping the claim to the missing built-in coordinator surface.

## Acceptance Tests

1. `AT-CREWAI-CLAIMS-001`: `website-v2/docs/compare-crewai.mdx` must acknowledge tracing, HITL, checkpointing, and app-defined governance while rejecting the stale absolute claims.
2. `AT-CREWAI-CLAIMS-002`: `website-v2/src/pages/compare/vs-crewai.mdx` must describe CrewAI recovery with source-backed checkpoint/resume wording and must not use the stale version-specific recovery claim.
3. `AT-CREWAI-CLAIMS-003`: `node --test cli/test/compare-crewai-claims.test.js` passes.
4. `AT-CREWAI-CLAIMS-004`: `cd website-v2 && npm run build` succeeds after the comparison copy changes.

## Open Questions

- If CrewAI adds protocol-native governance, approval gates, or cross-repo coordinator features later, the comparison should move again from `application-defined` language to a narrower, evidence-backed contrast.
