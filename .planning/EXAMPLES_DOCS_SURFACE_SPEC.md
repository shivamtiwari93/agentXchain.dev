# Examples Docs Surface Spec

## Purpose

Create a public-facing Docusaurus page that presents all five governed product examples with category differentiation, what each proves about AgentXchain governance, how to run each, and why the governed workflow shapes differ. Link it from multiple front-door discovery points.

## Interface

- **Route:** `/docs/examples`
- **Sidebar position:** After `templates`, before Protocol category
- **Navigation links:** Navbar (Docs dropdown), footer (Getting Started column), homepage CTA section

## Behavior

### Page structure

1. **Introduction** — one paragraph explaining that these are real products built under AgentXchain governance, not stubs or demos.
2. **Example cards** — one section per example with:
   - Category badge (Consumer SaaS, Mobile App, B2B SaaS, Developer Tool, Open Source Library)
   - What the product does
   - Team shape: roles and why they were chosen
   - Workflow phases: phase sequence and what each phase produces
   - How to run: exact commands to run tests and validate governance
   - Key workflow-kit artifacts: what governed artifacts each example produces
   - Link to source on GitHub
3. **Provenance explanation** — brief section explaining that governed build proof is: git history for each example directory, `TALK.md` per example, workflow-kit artifacts, and `template validate --json` proof. No copied `.agentxchain` runtime state.
4. **Protocol/runtime proof examples** — brief mention of `ci-runner-proof`, `governed-todo-app`, `remote-agent-bridge`, MCP examples as separate proof artifacts (not product examples).

### Omission rules

- Do not include `Baby Tracker` (v3 schema, not a governed product example).
- Do not include `external-runner-starter` (template, not product).
- Do not include `live-governed-proof` (proof scripts, not product).
- Do not include `remote-conformance-server` (protocol verification, not product).

## Error Cases

- If an example is removed from the repo, the docs guard test should catch the broken reference.

## Acceptance Tests

- AT-EDS-001: Page renders at `/docs/examples` with Docusaurus build
- AT-EDS-002: Page contains all five product example names (habit-board, trail-meals-mobile, async-standup-bot, decision-log-linter, schema-guard)
- AT-EDS-003: Page contains category labels for all five categories
- AT-EDS-004: Sidebar includes "Examples" entry
- AT-EDS-005: Footer includes "Examples" link
- AT-EDS-006: Page mentions provenance (TALK.md, git history, template validate)
- AT-EDS-007: Each example section includes run commands

## Open Questions

None.
