# Compare Page Decision Surface Spec

## Purpose

Preserve the sharper canonical compare-page format without dropping the decision criteria operators actually use to choose between orchestration frameworks and AgentXchain. The compare pages should stay concise, but they still need to surface the governance, recovery, and multi-repo boundaries that materially affect tool choice.

## Interface

Public surfaces:

- `website-v2/docs/compare/vs-autogen.mdx`
- `website-v2/docs/compare/vs-crewai.mdx`
- `website-v2/docs/compare/vs-langgraph.mdx`

Guard surfaces:

- `cli/test/comparison-pages-content.test.js`
- `cli/test/compare-autogen-claims.test.js`
- `cli/test/compare-crewai-claims.test.js`
- `cli/test/compare-langgraph-claims.test.js`

## Behavior

- The canonical compare pages for AG2 / AutoGen, CrewAI, and LangGraph must keep the tighter "short answer / comparison / choose when" structure introduced by the consolidation work.
- Those pages must also expose the three decision criteria that were lost when the old docs-only variants were deleted:
  - governance posture
  - recovery posture
  - multi-repo posture
- These criteria belong in the comparison table, not buried in prose, so readers can compare them quickly.
- The wording must stay comparative and current:
  - no stale absolute negatives such as `Manual`, `Not supported`, or `None built-in`
  - no speculative future claims about hosted/cloud offerings that are not part of today's public product surface
  - no category confusion between app-defined orchestration/runtime behavior and AgentXchain's repo-governance workflow
- The decision rows should sharpen the product wedge instead of bloating the page. Prefer one row per criterion over a larger matrix that repeats the same claim in multiple places.

## Error Cases

- A canonical compare page keeps the short format but omits governance posture, recovery posture, or multi-repo posture entirely.
- The missing criteria are reintroduced as stale absolute claims instead of scoped current wording.
- The comparison table grows back into an unmaintainable catch-all matrix with duplicate rows for the same concept.
- Planning specs still point to deleted `src/pages/compare/` or `docs/compare-*.mdx` paths after the consolidation move.

## Acceptance Tests

- `AT-CPDS-001`: `vs-autogen.mdx` includes scoped rows for governance posture, recovery posture, and multi-repo posture.
- `AT-CPDS-002`: `vs-crewai.mdx` includes scoped rows for governance posture and multi-repo posture alongside its existing recovery row.
- `AT-CPDS-003`: `vs-langgraph.mdx` includes scoped rows for governance posture, recovery posture, and multi-repo posture.
- `AT-CPDS-004`: `comparison-pages-content.test.js` guards the presence of these decision rows on the canonical pages.
- `AT-CPDS-005`: the compare-page claim specs and front-door spec reference the canonical `website-v2/docs/compare/` paths, not deleted locations.

## Open Questions

- None.
