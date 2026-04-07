# Comparison Page Spec

**Status:** Shipped and expanded on 2026-04-04; comparison contract and OpenAI page truth refreshed on 2026-04-07

Public website spec for targeted comparison pages under the Docusaurus surface.

## Purpose

Ship honest comparison pages that explain where AgentXchain fits relative to adjacent agent frameworks without collapsing into lazy "we beat everyone" marketing.

These pages exist because:

- the homepage positioning table is intentionally shallow and not enough for `agentxchain vs <framework>` searches
- the repo already has verified positioning truth in `.planning/COMPETITIVE_POSITIONING_MATRIX.md`
- public comparison copy must be code-backed and drift-resistant, not an orphaned marketing artifact

## Interface

### Routes

- `/compare/vs-crewai`
- `/compare/vs-langgraph`
- `/compare/vs-openai-agents-sdk`
- `/compare/vs-autogen`

### Inputs

- `.planning/COMPETITIVE_POSITIONING_MATRIX.md`
- `website-v2/src/pages/index.tsx`
- `website-v2/docusaurus.config.ts`

### Outputs

- four standalone MDX pages under `website-v2/src/pages/compare/`
- homepage comparison CTA links to all four pages
- navbar and footer links to all four pages
- a code-backed contract test guarding route presence, honest positioning, and internal docs linkage

## Behavior

Each comparison page must:

1. State the honest top-line verdict quickly.
2. Explicitly say where the competitor is stronger today.
3. Explain where AgentXchain is narrower and better suited.
4. Include at least one concrete example block that makes the governance gap legible.
5. Explain complementarity when that is the correct framing.
6. Link into `/docs/quickstart` and `/docs/protocol` so readers can verify claims.
7. Keep competitor strengths specific enough to survive source checks; vague "better at orchestration" copy is not acceptable.

### Page Structure

Each page must include:

- title and description frontmatter with the framework name
- `## The short answer`
- `## Comparison`
- `## Choose ... when`
- `## A concrete workflow difference`
- `## Using both together`
- at least one fenced code block
- explicit docs CTA links

### Content Constraints

- Do not claim competitors lack human review or observability outright.
- Do not claim AgentXchain replaces CrewAI, LangGraph, AG2 / AutoGen, or the OpenAI Agents SDK.
- Do not present AgentXchain as the strongest general orchestration framework.
- Do explicitly say each competitor is stronger in its own category.
- AutoGen copy must acknowledge current AG2 branding so the page is not historically stale on arrival.
- The OpenAI Agents SDK page must acknowledge current official strengths that matter to the comparison: provider-agnostic model support, built-in tracing/sessions, and built-in tool-approval interruptions resumable via `RunState`.

## Error Cases

- If a page says AgentXchain is better at generic orchestration, the page is wrong.
- If a page hides competitor strengths, the page is dishonest.
- If a page has no concrete example block, it is low-value SEO filler.
- If homepage, navbar, or footer links drift from the shipped routes, discoverability is broken.
- If the spec still points at retired `website/docs/*.html`, the spec is stale and untrustworthy.

## Acceptance Tests

- `AT-COMP-001`: `website-v2/src/pages/compare/vs-crewai.mdx` exists and includes honest CrewAI strengths, AgentXchain strengths, a code block, and docs links.
- `AT-COMP-002`: `website-v2/src/pages/compare/vs-langgraph.mdx` exists and includes honest LangGraph strengths, AgentXchain strengths, a code block, and docs links.
- `AT-COMP-003`: `website-v2/src/pages/compare/vs-openai-agents-sdk.mdx` exists and includes honest Agents SDK strengths, AgentXchain strengths, a code block, and docs links.
- `AT-COMP-004`: `website-v2/src/pages/compare/vs-autogen.mdx` exists and includes honest AG2 / AutoGen strengths, AgentXchain strengths, a code block, and docs links.
- `AT-COMP-005`: `website-v2/src/pages/index.tsx` links to all four comparison pages from the comparison surface.
- `AT-COMP-006`: `website-v2/docusaurus.config.ts` navbar and footer link to all four comparison pages.
- `AT-COMP-007`: Public claims remain consistent with `.planning/COMPETITIVE_POSITIONING_MATRIX.md`.
- `AT-COMP-008`: `cli/test/comparison-pages-content.test.js` guards route presence, required sections, docs links, and competitor-specific strengths for all four pages.

## Open Questions

- Should the site later ship a `/compare` index page once the comparison surface grows beyond four pages?
