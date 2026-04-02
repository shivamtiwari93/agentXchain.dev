# Static Docs Routing Spec

> Host-safe docs linking for the current static site.

---

## Purpose

Ensure every public docs link works on a dumb static host with no rewrite rules, no edge routing, and no framework build step.

Today the docs pages are physical files:

- `website/docs/quickstart.html`
- `website/docs/adapters.html`
- `website/docs/cli.html`
- `website/docs/plugins.html`
- `website/docs/protocol.html`
- `website/docs/protocol-v6.html`

Using extensionless links like `/docs/quickstart` is only safe if the host rewrites to `.html` or serves directory indexes. This repo does not currently declare such routing.

## Decision

**DEC-DOCS-ROUTING-001**: Internal site links and README links will use explicit `.html` doc targets until the project has an explicit rewrite/deployment contract.

Examples:

- `/docs/quickstart.html`
- `/docs/adapters.html`
- `/docs/cli.html`
- `/docs/plugins.html`
- `/docs/protocol.html`
- `/docs/protocol-v6.html`

## Behavior

1. Landing-page navigation points to explicit `.html` docs paths.
2. All docs-page nav/sidebar/footer links point to explicit `.html` docs paths.
3. README docs links use explicit `.html` paths.
4. Canonical URLs for docs pages also point to the explicit `.html` paths until pretty-URL routing is implemented and documented.

## Non-Goals

- Not a pretty-URL routing feature
- Not a hosting-platform decision
- Not a build-step introduction

## Acceptance Tests

1. `grep -R "/docs/quickstart\"" website README.md` returns 0 matches.
2. `grep -R "/docs/adapters\"" website README.md` returns 0 matches.
3. `grep -R "/docs/cli\"" website README.md` returns 0 matches.
4. `grep -R "/docs/protocol\"" website README.md` returns 0 matches.
5. Every docs link in `website/index.html` resolves directly to an existing file under `website/docs/`.

## Open Questions

1. Should we later switch to directory-style `website/docs/quickstart/index.html` paths instead of relying on `.html` URLs?
2. If pretty URLs are reintroduced, where is the routing contract declared: deployment config, web server config, or a static export step?
