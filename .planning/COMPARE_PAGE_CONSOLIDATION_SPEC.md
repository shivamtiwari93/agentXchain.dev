# Compare Page Consolidation Spec

## Purpose

Consolidate all compare pages into a single canonical location (`docs/compare/`) to eliminate duplicate content, make all 9 compare pages searchable, and establish a consistent architecture.

## Current State (broken)

- **3 pages in `docs/`** (compare-autogen.mdx, compare-crewai.mdx, compare-langgraph.mdx): older, inferior content; searchable via docs search; in sidebar under "Compare" category
- **9 pages in `src/pages/compare/`** (vs-autogen through vs-warp): newer, better content; NOT searchable; linked from navbar, footer, and homepage
- **3 competitors (AutoGen, CrewAI, LangGraph) have duplicate pages** in both locations with divergent content
- Navbar/footer/homepage all link to `/compare/vs-*` (standalone pages)
- Sidebar links to `/docs/compare-*` (docs pages)
- v2-99-0 release notes link to `/docs/compare-*`

## Decision

**Move all compare pages to `docs/compare/` as the single canonical location.**

### Rationale

1. All 9 pages become searchable (the docs search plugin indexes `docs/` only)
2. All 9 pages appear in the sidebar
3. Consistent URL scheme: `/docs/compare/vs-*`
4. Eliminates 3 duplicate pages with divergent content
5. Compare pages are product positioning — they should be findable when operators search for competitor names

### Rejected alternative: keep in `src/pages/compare/`

Would require making the search plugin index standalone pages (broader scope change) and would lose sidebar integration. The pages are fundamentally reference content (structured comparison tables), not marketing landing pages.

## Interface

### URL scheme

- Canonical: `/docs/compare/vs-{competitor}`
- Old docs URLs: `/docs/compare-{competitor}` → redirect to `/docs/compare/vs-{competitor}`
- Old standalone URLs: `/compare/vs-{competitor}` → redirect to `/docs/compare/vs-{competitor}`

### File layout

```
docs/compare/
  vs-autogen.mdx
  vs-codegen.mdx
  vs-crewai.mdx
  vs-devin.mdx
  vs-langgraph.mdx
  vs-metagpt.mdx
  vs-openai-agents-sdk.mdx
  vs-openhands.mdx
  vs-warp.mdx
```

### Sidebar

Replace the current `Compare` category items (`compare-crewai`, `compare-autogen`, `compare-langgraph`) with all 9 `compare/vs-*` entries.

### Navigation

Navbar dropdown, footer links, and homepage links all point to `/docs/compare/vs-*`.

## Behavior

- All 9 compare pages are indexed by docs search
- All 9 appear in the sidebar under a "Compare" category
- Old URLs redirect to new canonical URLs (no broken external links)
- No duplicate content exists

## Error Cases

- If `@docusaurus/plugin-client-redirects` is not installed, redirects won't work. Check if already in deps; install if needed.
- If any compare page has a `slug` frontmatter override, it may conflict with the directory-based URL. Verify no slug overrides exist.

## Acceptance Tests

- AT-CPC-001: No compare-page files exist under `src/pages/compare/`
- AT-CPC-002: No `compare-*.mdx` files exist directly under `docs/` (only under `docs/compare/`)
- AT-CPC-003: Exactly 9 compare files exist under `docs/compare/`
- AT-CPC-004: Sidebar config includes all 9 compare pages
- AT-CPC-005: Navbar compare dropdown links to `/docs/compare/vs-*` paths
- AT-CPC-006: Website builds cleanly
- AT-CPC-007: Redirect config maps old `/compare/vs-*` and `/docs/compare-*` URLs

## Open Questions

None. The spec is tight enough to implement.
