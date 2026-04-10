# Examples Docs Surface Spec

## Purpose

Add a first-class examples section to the public docs surface so each shipped example has its own page under `/docs/examples/*` instead of being collapsed into one index page.

The goal is not a marketing gallery. The goal is an operator-usable reference surface that explains what each example is, how AgentXchain governs it, how to run it, and what capability it proves.

## Interface

Public routes:

- `/docs/examples`
- `/docs/examples/habit-board`
- `/docs/examples/trail-meals-mobile`
- `/docs/examples/async-standup-bot`
- `/docs/examples/decision-log-linter`
- `/docs/examples/schema-guard`
- `/docs/examples/governed-todo-app`
- `/docs/examples/ci-runner-proof`
- `/docs/examples/external-runner-starter`
- `/docs/examples/live-governed-proof`
- `/docs/examples/mcp-echo-agent`
- `/docs/examples/mcp-http-echo-agent`
- `/docs/examples/mcp-anthropic-agent`
- `/docs/examples/remote-agent-bridge`
- `/docs/examples/remote-conformance-server`

Docs navigation:

- `website-v2/sidebars.ts` must expose `Examples` as a first-class category, similar to `Release Notes`
- the category must include the hub page plus every example detail page

Discoverability:

- `website-v2/static/llms.txt` must list the examples hub and the example detail pages
- `website-v2/static/sitemap.xml` must include the examples hub and the example detail pages

## Behavior

Each example detail page must include:

- what the example is
- what roles/workflow or protocol surface it uses
- how AgentXchain governed the build or enforces the contract
- how to run it
- key takeaways

The hub page must:

- group examples into meaningful categories
- link to every detail page
- distinguish governed product examples from proof/connector examples instead of pretending they are the same thing

## Error Cases

- Sidebar links to a page that does not exist
- An example page exists but omits run instructions
- The hub page mentions examples that do not have detail pages
- `llms.txt` or `sitemap.xml` omit the new public routes
- Docs claim a governed app workflow for a proof example that is actually a protocol/adapter harness

## Acceptance Tests

1. `website-v2/sidebars.ts` contains an `Examples` category with the hub page and all example detail pages.
2. `website-v2/docs/examples.mdx` links to every example detail page.
3. Each detail page exists on disk.
4. Each detail page includes headings for what it is, how to run it, and key takeaways.
5. Governed product example pages document their role/phase shape.
6. Proof/connector example pages document the protocol or adapter surface they exercise without pretending to be governed product apps.
7. `website-v2/static/llms.txt` lists the examples hub and all example detail pages.
8. `website-v2/static/sitemap.xml` lists the examples hub and all example detail pages.

## Open Questions

None. This is a docs-surface completion slice, not a new product capability.
