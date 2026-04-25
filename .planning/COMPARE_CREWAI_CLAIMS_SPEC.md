# Spec: CrewAI Comparison Claim Boundary

## Purpose

Freeze the public comparison contract for how AgentXchain describes CrewAI. The repo can make a sharp comparative case, but it must not deny current CrewAI capabilities that are documented upstream.

## Interface

- Files:
  - `website-v2/docs/compare/vs-crewai.mdx`
  - `.planning/COMPETITIVE_POSITIONING_MATRIX.md`
- Guard:
  - `cli/test/compare-crewai-claims.test.js`
  - `cli/test/comparison-pages-content.test.js`

## Behavior

- CrewAI comparison surfaces may contrast AgentXchain's protocol-native governance against CrewAI's application-defined workflows, but they must acknowledge current CrewAI capabilities where the docs explicitly provide them.
- Public copy should acknowledge that CrewAI now treats A2A as a first-class delegation primitive and can operate as both A2A client and server. Do not reduce CrewAI to local-only crews/flows if the current docs explicitly surface remote delegation and server modes.
- Public copy must not describe CrewAI recovery as `manual restart` because current CrewAI docs document checkpointing and resume for crews, flows, and agents.
- Public copy must not describe CrewAI oversight as merely `callback-based` when current CrewAI docs expose task `human_input` and flow `@human_feedback`.
- Public copy must not deny CrewAI observability entirely. When contrasting governance, it should distinguish protocol-native audit/decision surfaces from CrewAI tracing rather than claiming CrewAI has `no audit trail`. Current docs also surface exportable AMP traces and webhook-based enterprise HITL review/resume flows, so comparison text should not flatten those into generic `observability` or `callbacks` shorthand.
- Negative claims about unsupported coordinator or authority behavior should stay comparative and scoped. Use `no built-in cross-repo coordinator surface` or `governance stays app-defined`, not absolute product-negation that requires proving a negative across all possible CrewAI usage.
- The public comparison page must include an explicit official-source baseline with the last verification date. AgentXchain should not ask readers to trust competitor claims that are only buried in internal planning files.

## Error Cases

- A comparison surface reduces CrewAI to only local crews/flows and omits current A2A delegation/server capability.
- A comparison surface says CrewAI recovery is `manual restart`.
- A comparison surface says CrewAI human review is only `callback-based`.
- A comparison surface says CrewAI has `no audit trail` without distinguishing tracing from protocol-native governance.
- A comparison surface says `Any agent can do anything` instead of explaining the lack of protocol-enforced authority boundaries.
- A comparison surface says multi-repo is categorically `not supported` rather than scoping the claim to the missing built-in coordinator surface.
- A comparison surface lists AgentXchain verification links but omits CrewAI source links for the CrewAI side of the claims.

## Acceptance Tests

1. `AT-CREWAI-CLAIMS-001`: `website-v2/docs/compare/vs-crewai.mdx` must acknowledge tracing, HITL, checkpointing, and app-defined governance while rejecting the stale absolute claims.
2. `AT-CREWAI-CLAIMS-002`: `website-v2/docs/compare/vs-crewai.mdx` must acknowledge A2A delegation, webhook-based HITL review/resume, and exportable AMP tracing while keeping the product contrast on governed delivery.
3. `AT-CREWAI-CLAIMS-003`: `node --test cli/test/compare-crewai-claims.test.js` passes.
4. `AT-CREWAI-CLAIMS-004`: `cd website-v2 && npm run build` succeeds after the comparison copy changes.
5. `AT-CREWAI-CLAIMS-005`: the public CrewAI comparison includes official CrewAI docs links for crews, flows, tasks, HITL, checkpointing, A2A delegation, and observability/tracing, plus a current last-checked date.

## Open Questions

- If CrewAI adds protocol-native governance, approval gates, or cross-repo coordinator features later, the comparison should move again from `application-defined` language to a narrower, evidence-backed contrast.
