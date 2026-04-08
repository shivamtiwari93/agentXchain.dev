# Docs Publish Contract Spec

**Status:** Shipped
**Decision:** `DEC-DOCS-PUBLISH-002` through `DEC-DOCS-PUBLISH-006`

## Problem

The repo has two docs surfaces:

1. **`website-v2/`** — Docusaurus source. The repo-owned deploy workflow (`deploy-gcs.yml`) builds and deploys from `website-v2/build/`.
2. **`website/`** — Committed flat HTML files. **No CI workflow deploys these.** They are dead weight.

Every docs change requires updating both surfaces manually. This is the root cause of the drift GPT flagged in Turn 2 (GPT Turn 2). The flat files are never deployed, yet 5 test files assert against them, creating a maintenance burden for content that serves no production purpose.

## Decision

**Retire `website/` entirely.** Migrate all test assertions to check `website-v2/` Docusaurus source files (`.mdx`, `.tsx`) instead of flat HTML.

### Justification

- `deploy-gcs.yml` deploys `website-v2/build/` to `gs://agentxchain.dev/`
- Zero CI workflows reference `website/`
- Maintaining two manually-synced doc surfaces is a proven drift source
- The Docusaurus source files contain all the same content and more

## Changes

### 1. Delete `website/` directory

Remove all committed flat HTML: `index.html`, `why.html`, `docs.css`, `CNAME`, `assets/`, and `docs/*.html`.

### 2. Migrate test assertions

| Test file | Old reference | New reference |
|-----------|--------------|---------------|
| `protocol-docs-content.test.js` | `website/docs/protocol.html`, `website/docs/protocol-v6.html` | `website-v2/docs/protocol.mdx` |
| `plugin-docs-content.test.js` | `website/docs/plugins.html`, `website/docs/cli.html`, nav across 6 HTML pages | `website-v2/docs/plugins.mdx`, `website-v2/docs/cli.mdx`, sidebar wiring |
| `why-page-content.test.js` | `website/why.html`, `website/index.html` | `website-v2/src/pages/why.mdx`, `website-v2/src/pages/index.tsx` |
| `launch-evidence.test.js` | `website/index.html`, `website/why.html` | `website-v2/src/pages/index.tsx`, `website-v2/src/pages/why.mdx` |
| `openai-positioning-content.test.js` | `website/index.html`, `website/why.html` | `website-v2/src/pages/index.tsx`, `website-v2/src/pages/why.mdx` |
| `templates-docs-content.test.js` | `existsSync` check for `website/docs/templates.html` | Remove flat-file existence check |

### 3. Update planning specs

Any planning spec that references `website/` flat files (e.g., `LAUNCH_BRIEF.md`, `STATIC_DOCS_ROUTING_SPEC.md`) must be updated to reference `website-v2/` source.

### 4. Single source of truth

After this change: `website-v2/` is the sole docs source. CI builds and deploys it. Tests assert against it. No flat HTML surface exists.

## Acceptance Tests

- AT-DP-001: `website/` directory does not exist in the repo
- AT-DP-002: No test file under `cli/test/` references `website/` (except negatively, asserting it doesn't exist)
- AT-DP-003: `npm test` passes with 0 failures
- AT-DP-004: `website-v2/` builds successfully (`npm run build`)
- AT-DP-005: All content previously asserted against flat HTML is now asserted against Docusaurus source

## Open Questions

None. The decision is unambiguous: `website/` is dead weight that no workflow deploys.
