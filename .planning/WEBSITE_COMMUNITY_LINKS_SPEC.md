# Website Community Links Spec

## Purpose

Expose AgentXchain's public community surfaces directly on `agentxchain.dev` so visitors can discover the Reddit community and X/Twitter profile without relying on external search.

## Interface

- Navbar adds a `Community` dropdown with:
  - `X / Twitter` -> `https://x.com/agentXchain_dev`
  - `Reddit` -> `https://www.reddit.com/r/agentXchain_dev/`
- Footer adds a `Community` column with the same two links.
- Homepage adds a `Community` section with icon-backed external links to the same destinations.

## Behavior

- All community links must open in a new tab.
- Homepage community links must show recognizable X and Reddit icons.
- Navbar and footer links must use the same canonical URLs as the homepage section.
- Community links must be first-class public navigation, not hidden only in planning docs.

## Error Cases

- Missing one of the two community destinations.
- Using inconsistent URLs across navbar, homepage, and footer.
- Regressing to same-tab navigation for external community links.
- Adding iconography only in planning docs while leaving the rendered homepage plain text.

## Acceptance Tests

- `AT-WCL-001`: `website-v2/docusaurus.config.ts` contains a `Community` navbar dropdown and footer section with both canonical URLs.
- `AT-WCL-002`: `website-v2/src/pages/index.tsx` contains a homepage community section with both canonical URLs and explicit `target="_blank"` / `rel="noopener noreferrer"` behavior.
- `AT-WCL-003`: `website-v2/src/pages/index.tsx` defines recognizable X and Reddit icon components used in the homepage community links.
- `AT-WCL-004`: `cd website-v2 && npm run build` succeeds after the community links are added.
