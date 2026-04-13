# Integrations Index Source Of Truth Spec

## Purpose

Freeze a single repo-native source of truth for the public integrations index so guide summaries and index summaries cannot drift independently.

The immediate trigger is factual drift across three guides:

- Google Jules was presented as a native integration when the repo only ships the Gemini-compatible path today.
- Windsurf was presented as a direct CLI integration when no verified native headless runtime exists.
- Cursor was presented as a direct CLI integration when no verified native headless runtime exists.

The index must stop being a second hand-written truth surface.

## Interface

Create a shared metadata module for the integrations catalog:

- File: `website-v2/src/data/integrations.js`
- Export: `integrationSections`

Each section entry must contain:

- `title`
- `items`

Each item must contain:

- `title`
- `href`
- `summary`

The docs page `website-v2/docs/integrations/index.mdx` must render its platform lists from `integrationSections` instead of duplicating the lists inline.

## Behavior

1. The integrations index page remains at `/docs/integrations/`.
2. The page keeps the adapter table and high-level explanatory copy.
3. The per-platform lists are rendered from shared metadata.
4. Truth-boundary-sensitive summaries live only in the metadata module, not duplicated in multiple docs surfaces.
5. The metadata must preserve the current truthful public wording for the non-native entries:
   - Cursor: editor + separate CLI agent, no native Cursor connector yet
   - Windsurf: editor + separate CLI agent, no native Windsurf connector yet
   - Google Jules: Gemini path today, native Jules connector not yet shipped

## Error Cases

- If a guide is corrected but the metadata is not updated, the index becomes stale again. Tests must fail.
- If the index page stops importing the shared metadata and goes back to inline lists, tests must fail.
- If future entries reintroduce direct-integration claims for unsupported products, tests must fail.

## Acceptance Tests

1. A regression test imports `integrationSections` and asserts the Jules, Cursor, and Windsurf summaries preserve the truthful boundary.
2. A regression test asserts the index page renders from the shared source instead of containing the old hand-written bullet list.
3. `node --test cli/test/integration-guide-factual-accuracy.test.js` passes.
4. `cd website-v2 && npm run build` passes.

## Open Questions

- Should the sidebar, sitemap generation, or homepage integrations surface eventually consume the same metadata module? Not in this slice.
