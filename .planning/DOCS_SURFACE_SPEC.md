# Docs Surface Spec — AgentXchain.dev

> Lightweight documentation strategy. No framework adoption until information architecture is proven.

---

## Purpose

Expose documentation on agentxchain.dev without adopting Docusaurus, Starlight, or any docs framework. Prove the IA first, then decide if a framework is warranted.

## Decision

**DEC-DOCS-001**: Documentation will be served as static HTML pages under `/docs/` on agentxchain.dev, using the same visual design system as the landing page. No build step. No framework. Each page is a standalone `.html` file.

**Rationale**: The project has ~4 docs pages worth of content. A framework adds dependency surface, build complexity, and design inconsistency for zero gain at this scale. If docs grow past ~10 pages, revisit.

## Pages

### Phase 1 (pre-launch)

| Path | Content Source | Purpose |
|------|---------------|---------|
| `/docs/quickstart` | New content | 5-minute getting-started: install, init, step, accept, approve, ship |
| `/docs/protocol` | `PROTOCOL-v6.md` rendered (latest alias) | The current protocol specification |
| `/docs/protocol-v6` | `PROTOCOL-v6.md` rendered (versioned permalink) | Immutable v6 protocol reference |
| `/docs/adapters` | New content | How the three adapters work, how to add a new one |
| `/docs/cli` | `.planning/CLI_SPEC.md` rendered | Complete CLI command reference |

### Phase 2 (post-launch, demand-driven)

| Path | Content Source | Purpose |
|------|---------------|---------|
| `/docs/examples` | New content | Walkthrough of a governed todo-app build |
| `/docs/faq` | Show HN responses + common questions | Anticipated objections answered |
| `/docs/contributing` | New content | How to contribute adapters, roles, protocol extensions |

## Design Constraints

1. **Same stylesheet** as `index.html`. Docs pages import the same CSS variables and component styles. No separate design system.
2. **No JavaScript required** for reading docs. Pages are static HTML with optional nav enhancement.
3. **Nav bar** gets a "Docs" link pointing to the quickstart page. Until host-level rewrite support exists, internal links should use explicit `.html` targets for host-safe static routing.
4. **Code blocks** use the same `JetBrains Mono` + dark background treatment as the landing page terminal.
5. **Mobile-first**. Sidebar collapses to a top dropdown on screens < 768px.

## Implementation

Each docs page is a file at `website/docs/{slug}.html` with this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Same meta, fonts, base styles as index.html -->
  <link rel="stylesheet" href="../docs.css" />
</head>
<body>
  <nav><!-- Same nav as index.html with "Docs" active --></nav>
  <div class="docs-layout">
    <aside class="docs-sidebar"><!-- Page list --></aside>
    <main class="docs-content"><!-- Content --></main>
  </div>
  <footer><!-- Same footer --></footer>
</body>
</html>
```

Shared styles go in `website/docs.css`. Page-specific content is inline HTML — no markdown rendering, no build step.

## Acceptance Tests

1. Each docs page loads without JavaScript enabled
2. Each docs page passes Lighthouse accessibility audit (score >= 90)
3. Nav bar "Docs" link is visible on the landing page
4. Sidebar navigation works on mobile (< 768px)
5. Code blocks are syntax-highlighted and horizontally scrollable
6. All internal links resolve (no 404s)

## Open Questions

1. Should the protocol spec page be a faithful rendering of the markdown, or a restructured "reference" page? The spec is 800+ lines and may need a table of contents.
2. Should we extract shared HTML (nav, footer) into partials and use a simple include mechanism (e.g., a 10-line build script with `sed`), or keep each page fully self-contained?

## What This Is NOT

- Not a docs framework adoption decision
- Not a content management system
- Not a blog (if we add a blog later, it gets its own spec)
