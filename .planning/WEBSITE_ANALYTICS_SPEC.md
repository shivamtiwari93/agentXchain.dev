# Website Analytics Spec

## Purpose

Keep the public website analytics surface truthful and durable:

- GA4 is configured once at the Docusaurus site level
- all pages inherit analytics through the framework, including docs and comparison pages
- the repo does not drift into duplicate or hand-injected tracking snippets

## Interface

### Source of Truth

- `website-v2/docusaurus.config.ts`

### Required Config

Within the Docusaurus `classic` preset:

```ts
gtag: {
  trackingID: 'G-1Z8RV9X341',
  anonymizeIP: true,
}
```

## Behavior

1. Analytics uses Docusaurus `gtag` support, not manual inline script injection.
2. The configured GA4 property ID is `G-1Z8RV9X341`.
3. `anonymizeIP` remains enabled.
4. Because analytics is configured at the site level, all Docusaurus routes inherit it:
   - homepage
   - docs pages
   - `/why`
   - comparison pages
5. The public site must not rely on per-page analytics snippets in MDX or React page files.

## Error Cases

- `gtag` config removed from `docusaurus.config.ts`
- GA4 property ID changed unintentionally
- `anonymizeIP` disabled
- manual `googletagmanager` snippet added alongside Docusaurus `gtag`, causing duplicate instrumentation

## Acceptance Tests

- AT-WA-001: Repo test asserts `website-v2/docusaurus.config.ts` declares `gtag.trackingID = 'G-1Z8RV9X341'`.
- AT-WA-002: Repo test asserts `website-v2/docusaurus.config.ts` declares `anonymizeIP: true`.
- AT-WA-003: Repo test asserts the config does not hand-inject a `googletagmanager` snippet or `window.dataLayer` bootstrap.
- AT-WA-004: Manual verification confirms the live site HTML contains `G-1Z8RV9X341` and `googletagmanager`.

## Open Questions

- Whether a later slice should add first-class consent controls instead of unconditional GA4 loading.
