## Purpose

Make the self-build case study a real front-door adoption surface instead of a buried docs page.

The page already exists and is tested for content truth. This slice is about discoverability on the highest-traffic surfaces a cold operator actually sees.

## Interface

- Existing docs page:
  - `website-v2/docs/case-study-self-build.mdx`
- Homepage discoverability:
  - `website-v2/src/pages/index.tsx`
- Footer discoverability:
  - `website-v2/docusaurus.config.ts`
- Repo front-door discoverability:
  - `README.md`
- Guard test:
  - `cli/test/case-study-self-build-content.test.js`

## Behavior

- The homepage must link to `/docs/case-study-self-build` from a proof-oriented section, not hide it only in the docs sidebar.
- The homepage link text must explain why the page matters:
  - AgentXchain built itself
  - evidence-backed case study
- The repo `README.md` documentation list must include the case study so GitHub visitors can reach it without browsing the docs tree.
- The website footer must include a direct link to the case study.
- The page must remain discoverable without depending on search, `llms.txt`, or sidebar scrolling.

## Error Cases

- Do not duplicate the case-study link in every navbar surface just to inflate visibility; that creates noise, not clarity.
- Do not present the case study as a vague marketing story. The surrounding copy must keep the evidence-backed framing.
- Do not ship the docs page with no homepage or README path; that is a stranded surface, not an adoption asset.
- Do not remove existing `llms.txt` or sidebar inclusion while adding new discoverability paths.

## Acceptance Tests

- `website-v2/src/pages/index.tsx` links to `/docs/case-study-self-build`
- The homepage copy names the self-build framing (`AgentXchain built itself` or equivalent evidence-backed wording)
- `README.md` links to `https://agentxchain.dev/docs/case-study-self-build`
- `website-v2/docusaurus.config.ts` includes a footer link to `/docs/case-study-self-build`
- `cli/test/case-study-self-build-content.test.js` asserts the homepage, README, and footer discoverability paths

## Open Questions

- None. This is a front-door docs discoverability fix, not a protocol decision.
