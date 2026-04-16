# Product Boundary Surface Spec

## Purpose

Keep the public `.dev` vs `.ai` boundary truthful across the repo-controlled front door.

AgentXchain.dev is the open-source, self-hosted core that ships today. AgentXchain.ai is the managed cloud surface built on the same protocol, but the public site currently presents it as early access / coming soon rather than a fully generally available cloud runtime. Public copy must not blur that boundary in either direction.

## Interface

Public surfaces:

- `README.md`
- `website-v2/src/pages/index.tsx`
- `website-v2/docs/compare-langgraph.mdx`
- `website-v2/src/pages/compare/vs-codegen.mdx`
- `website-v2/src/pages/compare/vs-metagpt.mdx`
- `website-v2/src/pages/compare/vs-openhands.mdx`

Guard surface:

- `cli/test/product-boundary-surface.test.js`

## Behavior

1. `README.md` must describe `agentxchain.dev` as the open-source surface and `agentxchain.ai` as the managed cloud surface in early access.
2. `README.md` must not label `agentxchain.ai` as a generic "commercial cloud" product without the early-access qualifier.
3. The homepage platform split must present `agentxchain.ai` as a managed cloud preview / early-access surface, not as a fully shipped no-qualification cloud experience.
4. The homepage `agentxchain.ai` card may describe the intended dashboard, apps, and managed state/history direction, but it must also make the preview / early-access status explicit.
5. Public comparison copy that discusses cloud/hosting must not call `agentxchain.ai` merely "planned" or hypothetical. It is a real managed-cloud surface with a public early-access site.
6. Comparison copy must still be honest that hosted cloud execution is stronger and more available today on LangGraph Platform than on AgentXchain's early-access managed surface.
7. Comparison pages with an explicit hosting row must not collapse AgentXchain back to a purely self-hosted-only product shape when the repo-controlled boundary already exposes `agentxchain.ai` as a public managed-cloud early-access surface.
8. Comparison pages with a hosted-product or hosted-surface row must not describe AgentXchain's managed `.ai` surface as merely future or hypothetical when the public early-access site already exists.

## Error Cases

- README says `AgentXchain.ai (commercial cloud)` with no early-access qualifier.
- Homepage says `Managed cloud experience` with no preview / early-access qualifier.
- Homepage promises a fully available managed product without acknowledging preview status.
- Comparison copy says `planned agentxchain.ai cloud`, implying the managed cloud surface does not exist publicly at all.
- Comparison copy implies AgentXchain already matches LangGraph Platform as a mature hosted-cloud runtime today.
- A comparison table says AgentXchain is only `Self-hosted, local-first, open source` on a hosting row, erasing the public `agentxchain.ai` managed-cloud early-access surface.
- A comparison table says AgentXchain's managed `.ai` surface is `later`, `planned`, or otherwise hypothetical on a hosted-product row.

## Acceptance Tests

- `AT-PBS-001`: `README.md` describes `agentxchain.ai` as the managed cloud surface in early access and rejects the stale `commercial cloud` label.
- `AT-PBS-002`: `website-v2/src/pages/index.tsx` presents `agentxchain.ai` as a managed cloud preview / early-access surface and rejects the stale `Managed cloud experience` wording.
- `AT-PBS-003`: `website-v2/docs/compare-langgraph.mdx` describes AgentXchain on the cloud axis as self-hosted today plus `agentxchain.ai` managed-cloud early access, and rejects `planned agentxchain.ai cloud`.
- `AT-PBS-004`: the same comparison page still makes clear that LangGraph is the stronger choice when the requirement is hosted cloud execution today.
- `AT-PBS-005`: `website-v2/src/pages/compare/vs-codegen.mdx` must present AgentXchain's hosting model as the open-source self-hosted core plus `agentxchain.ai` managed-cloud early access, and reject the stale self-host-only wording.
- `AT-PBS-006`: `website-v2/src/pages/compare/vs-metagpt.mdx` must present AgentXchain's hosted-product boundary as the open-source self-hosted core plus `agentxchain.ai` managed-cloud early access, and reject the stale `managed .ai surface later` wording.
- `AT-PBS-007`: `website-v2/src/pages/compare/vs-openhands.mdx` must present AgentXchain's hosting model as the open-source self-hosted core plus `agentxchain.ai` managed-cloud early access, and reject the stale self-host-only wording.

## Open Questions

- If `agentxchain.ai` reaches broad availability later, should the repo switch from `early access` to a lifecycle term like `managed cloud` or `generally available` everywhere at once through this same guard?
