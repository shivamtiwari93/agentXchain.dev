# Spec: AutoGen Comparison Claim Boundary

## Purpose

Freeze the public comparison contract for how AgentXchain describes AG2 / AutoGen. The repo can make a sharp governance-vs-conversation case, but it must not rely on stale absolutes when current AG2 docs explicitly expose human-in-the-loop flows, tracing, guardrails/safeguards, AG-UI/A2A interoperability, and resume-from-history behavior.

## Interface

- Files:
  - `website-v2/src/pages/compare/vs-autogen.mdx`
  - `website-v2/docs/compare-autogen.mdx`
- Guard:
  - `cli/test/compare-autogen-claims.test.js`

## Behavior

- AutoGen comparison surfaces may contrast AgentXchain's protocol-native governance against AG2's conversation-oriented orchestration, but they must acknowledge current upstream capabilities where the docs explicitly provide them.
- Public copy must not describe AG2 governance as simply `None built-in`. Current AG2 docs expose guardrails/safeguards, tracing, and HITL patterns; the narrower defensible contrast is `no built-in repository-delivery governance layer`.
- Public copy must not describe AG2 human oversight as only a `Human proxy agent in conversation`. Current docs expose `human_input_mode`, user agents, and A2A/AG-UI human-in-the-loop flows.
- Public copy must not describe AG2 recovery as merely `Manual` or say a crash means the conversation is simply lost. Current docs expose resume-from-history behavior; the real boundary is that durability remains app-managed and conversation-centric rather than a repo-native governance surface.
- Public copy must not say AG2 has no IDE/UI integration at all. Current docs expose AG-UI and application-defined integrations even though AG2 does not ship AgentXchain-style repo-governance IDE adapters.
- Negative coordination claims should stay scoped. Use `no built-in cross-repo coordinator surface`, not categorical `Not supported`, unless upstream docs explicitly rule the capability out.

## Error Cases

- A comparison surface says AG2 governance is `None built-in`.
- A comparison surface says AG2 human oversight is only `Human proxy agent in conversation`.
- A comparison surface says AG2 recovery is `Manual`.
- A comparison surface says a process crash means `the conversation is lost`.
- A comparison surface says IDE integration is `None (Python library)`.
- A comparison surface says multi-repo is categorically `Not supported`.

## Acceptance Tests

1. `AT-AUTOGEN-CLAIMS-001`: `website-v2/docs/compare-autogen.mdx` must use scoped governance, HITL, recovery, and multi-repo wording while rejecting the stale absolutes.
2. `AT-AUTOGEN-CLAIMS-002`: `website-v2/src/pages/compare/vs-autogen.mdx` must describe AG2 oversight/observability with current guardrails, tracing, and HITL wording.
3. `AT-AUTOGEN-CLAIMS-003`: `node --test cli/test/compare-autogen-claims.test.js` passes.
4. `AT-AUTOGEN-CLAIMS-004`: `cd website-v2 && npm run build` succeeds after the comparison copy changes.

## Open Questions

- If AG2 later ships first-class repository governance or a built-in cross-repo coordinator surface, this comparison should narrow again to the exact remaining boundary instead of holding onto older negative shorthand.
