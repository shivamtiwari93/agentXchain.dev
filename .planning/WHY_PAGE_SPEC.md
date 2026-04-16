# Why Page Spec

> Public long-form essay surface for the governed-delivery thesis.

---

## Purpose

Turn `.planning/WHY_GOVERNED_MULTI_AGENT_DELIVERY.md` into a public, linkable website page that explains the mechanism behind AgentXchain without forcing readers to reconstruct the thesis from the landing page and CLI docs.

This page is a launch asset, not a product manual. It should help a skeptical reader understand:

- why multi-agent coding fails without governance
- why manager-worker delegation is insufficient
- what AgentXchain enforces differently
- where humans retain authority
- how the protocol stays model-agnostic

## Interface

- Public URL: `https://agentxchain.dev/why/` (source: `website-v2/src/pages/why.mdx`)
- Discoverability surfaces:
  - `website-v2/src/pages/index.tsx` nav/footer
  - `README.md`
  - `cli/README.md`
  - `.planning/LAUNCH_BRIEF.md`
- Supporting source artifact:
  - `.planning/WHY_GOVERNED_MULTI_AGENT_DELIVERY.md`

## Behavior

The page MUST:

1. Lead with the governance bottleneck, not generic AI hype.
2. Critique the manager-worker pattern directly and specifically.
3. Explain mandatory challenge as an enforced protocol rule, not a prompt suggestion.
4. Show structured turn-result evidence with a concrete JSON example.
5. Explain constitutional human authority using actual phase/ship approval checkpoints.
6. Document runtime portability through all five shipped adapter paths: `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`.
7. Link readers to the governed quickstart and protocol docs.

The page MUST NOT:

- invent unshipped product features
- weaken the mechanism-first positioning into vague “AI teamwork” copy
- become a second CLI reference page
- depend on a site build system or blog framework

## Error Cases

- If the public page drifts from the planning essay, the planning essay must be updated in the same change or explicitly narrowed to “source notes” only.
- If the page claims comparisons against other tools, those claims must stay aligned with the competitive positioning matrix and avoid pretending AgentXchain wins adjacent categories it does not target.
- If a discoverability surface links to the page, the link must use the real deployed path `/why/` (Docusaurus clean URL), not a bare `why.html` or a future route that does not exist yet.

## Acceptance Tests

### AT-WHY-001: Public page exists and is linkable
Given the website files are read directly from the repo, when `website-v2/src/pages/why.mdx` is inspected, then it contains a title and at least one link each to quickstart and protocol docs.

### AT-WHY-002: Mechanism-first thesis is present
Given the public page content, when a reader scans the page, then it explicitly covers the governance bottleneck, the manager-worker critique, mandatory challenge, and human gate authority.

### AT-WHY-003: Runtime portability is explicit
Given the public page content, when the runtime section renders, then it names `manual`, `local_cli`, `api_proxy`, `mcp`, and `remote_agent`, and it does not collapse the product back to a stale three-adapter subset.

### AT-WHY-004: Discoverability surfaces expose the page
Given the homepage and READMEs, when they are inspected, then each contains a link to the `/why/` page.

### AT-WHY-005: Launch brief reflects reality
Given `.planning/LAUNCH_BRIEF.md`, when the launch surfaces table is inspected, then the long-form post is marked published/ready rather than “not written.”

## Open Questions

- Should a later launch pass also add the essay to the docs-page top nav, or is homepage/README discoverability sufficient for v1.0?
- Should the eventual hosted blog keep `/why/` as a permanent canonical page, or redirect it to a future `/blog/...` route after the site supports richer publishing?
