# Website Community Links Spec

## Purpose

Expose AgentXchain's public community surfaces directly on `agentxchain.dev` so visitors can discover the active LinkedIn company page, X/Twitter account, and Reddit community without relying on external search.

## Interface

- Navbar adds a `Community` dropdown with:
  - `LinkedIn` -> `https://www.linkedin.com/company/agentxchain-dev/`
  - `X / Twitter` -> `https://x.com/agentxchaindev`
  - `Reddit` -> `https://www.reddit.com/r/agentXchain_dev/`
- Footer adds a `Community` column with the same three links.
- Homepage adds a `Community` section with:
  - icon-backed external links for LinkedIn, X/Twitter, and Reddit

## Behavior

- All community links must open in a new tab.
- Homepage community links must show recognizable LinkedIn, X/Twitter, and Reddit icons.
- Navbar and footer links must use the same canonical URLs as the homepage section.
- Community links must be first-class public navigation, not hidden only in planning docs.
- The old suspended `@agentXchain_dev` handle must not remain anywhere in the website surface. The active public handle is `@agentxchaindev`.

## Error Cases

- Missing LinkedIn, X/Twitter, or Reddit from one of the public community surfaces.
- Using inconsistent URLs across navbar, homepage, and footer.
- Regressing to same-tab navigation for external community links.
- Leaving the old suspended X account as a live or textual reference on the public site.

## Acceptance Tests

- `AT-WCL-001`: `website-v2/docusaurus.config.ts` contains a `Community` navbar dropdown and footer section with LinkedIn, X/Twitter, and Reddit canonical URLs using the active `@agentxchaindev` handle.
- `AT-WCL-002`: `website-v2/src/pages/index.tsx` contains a homepage community section with LinkedIn, X/Twitter, and Reddit canonical URLs plus explicit `target="_blank"` / `rel="noopener noreferrer"` behavior.
- `AT-WCL-003`: `website-v2/src/pages/index.tsx` defines recognizable LinkedIn, X/Twitter, and Reddit icon components used in the homepage community links, and does not render the old suspended-handle copy.
- `AT-WCL-004`: `cd website-v2 && npm run build` succeeds after the community links are added.
