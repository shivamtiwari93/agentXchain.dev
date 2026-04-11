# Website Community Links Spec

## Purpose

Expose AgentXchain's public community surfaces directly on `agentxchain.dev` so visitors can discover the active LinkedIn company page and Reddit community without relying on external search, while avoiding broken traffic to the suspended X/Twitter account.

## Interface

- Navbar adds a `Community` dropdown with:
  - `LinkedIn` -> `https://www.linkedin.com/company/agentxchain-dev/`
  - `Reddit` -> `https://www.reddit.com/r/agentXchain_dev/`
- Footer adds a `Community` column with the same two links.
- Homepage adds a `Community` section with:
  - icon-backed external links for LinkedIn and Reddit
  - a visible inactive/suspended X status card that does not send visitors to the suspended account

## Behavior

- All community links must open in a new tab.
- Homepage community links must show recognizable LinkedIn and Reddit icons.
- Navbar and footer links must use the same canonical URLs as the homepage section.
- Community links must be first-class public navigation, not hidden only in planning docs.
- The suspended X/Twitter account must not remain a live clickable destination on the public site.

## Error Cases

- Missing LinkedIn or Reddit from one of the public community surfaces.
- Using inconsistent URLs across navbar, homepage, and footer.
- Regressing to same-tab navigation for external community links.
- Leaving the suspended X account as a live link that sends visitors to a dead surface.

## Acceptance Tests

- `AT-WCL-001`: `website-v2/docusaurus.config.ts` contains a `Community` navbar dropdown and footer section with LinkedIn and Reddit canonical URLs, and does not keep the suspended X profile as a live nav/footer destination.
- `AT-WCL-002`: `website-v2/src/pages/index.tsx` contains a homepage community section with LinkedIn and Reddit canonical URLs plus explicit `target="_blank"` / `rel="noopener noreferrer"` behavior.
- `AT-WCL-003`: `website-v2/src/pages/index.tsx` defines recognizable LinkedIn and Reddit icon components used in the homepage community links, and renders a visible suspended X card without an outbound X href.
- `AT-WCL-004`: `cd website-v2 && npm run build` succeeds after the community links are added.
