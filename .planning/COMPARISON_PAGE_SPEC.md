# Comparison Page Spec

> Public website spec for targeted SEO comparison pages.
> Scope for Turn 16: `website/docs/vs-crewai.html` and `website/docs/vs-langgraph.html`

---

## Purpose

Ship dedicated comparison pages that explain where AgentXchain fits relative to adjacent agent frameworks without drifting into lazy "we win everything" marketing.

These pages exist because:

- the landing-page comparison table is too shallow to rank or convert for `agentxchain vs <framework>` searches
- the repo already has verified positioning language in `.planning/COMPETITIVE_POSITIONING_MATRIX.md`
- public copy must make the governance wedge concrete with examples, not slogans

## Interface

### Routes

- `/docs/vs-crewai.html`
- `/docs/vs-langgraph.html`

### Inputs

- public positioning already approved in `.planning/COMPETITIVE_POSITIONING_MATRIX.md`
- existing static docs shell in `website/docs/*.html`
- current landing-page comparison table in `website/index.html`

### Outputs

- two standalone HTML pages under `website/docs/`
- homepage links pointing to both comparison pages from the comparison section and footer

## Behavior

Each comparison page must:

1. State the honest top-line verdict quickly.
2. Explain where the competitor is stronger today.
3. Explain where AgentXchain is narrower and better suited.
4. Show one concrete workflow/code example that makes the governance gap legible.
5. Explain complementarity when that is the correct framing.
6. Link back into AgentXchain docs and protocol pages so readers can verify claims.

### Page Structure

Each page should include:

- SEO-aware title and meta description with the framework name
- hero section with concise verdict
- "short answer" section
- comparison matrix focused on governance, not generic orchestration
- "choose X when..." guidance for both tools
- concrete example snippet
- direct CTA into AgentXchain quickstart/protocol

### Content Constraints

- Do not claim competitors lack human review or observability outright.
- Do not claim AgentXchain replaces CrewAI or LangGraph.
- Do not present AgentXchain as the strongest general orchestration framework.
- Do explicitly say CrewAI and LangGraph are stronger in their own categories.

## Error Cases

- If a page says AgentXchain is better at generic orchestration, the page is wrong.
- If a page hides competitor strengths, the page is dishonest.
- If a page duplicates the landing-page table without a concrete example, it is low-value SEO filler.
- If the pages are not linked from the homepage, they are discoverability theater.

## Acceptance Tests

1. `website/docs/vs-crewai.html` exists with:
   - canonical URL
   - references to both CrewAI strengths and AgentXchain strengths
   - at least one concrete code/example block
2. `website/docs/vs-langgraph.html` exists with:
   - canonical URL
   - references to both LangGraph strengths and AgentXchain strengths
   - at least one concrete code/example block
3. `website/index.html` links to both new pages from the comparison surface.
4. `website/index.html` footer links to both new pages.
5. Public claims remain consistent with `.planning/COMPETITIVE_POSITIONING_MATRIX.md`.

## Open Questions

1. Should we add a third page for `vs-openai-agents-sdk.html` after these two ship?
2. Should we create a comparison index page once there are 3+ dedicated comparisons?
