# Protocol Doc Page Spec

> Last updated: 2026-04-02 (Turn 7, Claude Opus 4.6)

---

## Purpose

Render the governed protocol specification (SPEC-GOVERNED-v5.md) as a browsable, static HTML docs page at `/docs/protocol`. This is the normative reference for operators and adapter authors who need to understand the protocol contract without reading raw markdown on GitHub.

## Interface

- **URL**: `/docs/protocol` → `website/docs/protocol.html`
- **Stylesheet**: `website/docs.css` (shared)
- **Nav pattern**: Matches existing docs pages (quickstart, adapters, cli)
- **Sidebar**: "Docs" section links + "On this page" section anchors

## Page Structure

The page does NOT reproduce the spec verbatim. It reorganizes the spec content into a browsable reference with these sections:

1. **Overview** — What the protocol is, what it governs, v1.0/v1.1 scope
2. **Runtime Model** — Run State, Turn Assignment, Turn Result (the three entities)
3. **Configuration** — `agentxchain.json` top-level shape, roles, runtimes, routing, gates, budget, validation rules
4. **State Machine** — Run states, transitions, key rules, acceptance serialization, conflict detection
5. **Turn Result Contract** — Full schema, required invariants, verification normalization, cost accounting
6. **Validation Pipeline** — Five stages (Schema → Assignment → Artifact → Verification → Protocol)
7. **Dispatch Bundles** — Turn-scoped bundles, parallel isolation, conflict context in redispatch
8. **Repo Observation** — Baseline capture, change observation, declared vs observed, integration ref derivation
9. **Challenge Requirement** — The mandatory objection rule and enforcement mechanics
10. **File Layout** — Directory structure, reserved paths
11. **Error Taxonomy** — Error codes, retryable vs non-retryable
12. **v1.0 Compatibility** — Config compat, state migration, behavioral preservation

## Behavior

- Static HTML, no JavaScript required
- All code examples use `<pre><code>` with inline styling consistent with docs.css
- JSON schemas shown as formatted blocks
- Tables for enums, error codes, state transitions
- Internal cross-references use `#section-id` anchors
- External links to GitHub for full spec source

## Error Cases

- N/A (static page)

## Acceptance Tests

- [ ] AT-1: Page loads at `/docs/protocol` and renders all 12 sections
- [ ] AT-2: All sidebar "On this page" links scroll to the correct section
- [ ] AT-3: Nav links to Quickstart, Adapters, CLI, Protocol are all present and correct
- [ ] AT-4: Footer links match other docs pages
- [ ] AT-5: Page passes HTML parsing without errors
- [ ] AT-6: All three existing docs pages (quickstart, adapters, cli) link to `/docs/protocol` instead of the raw GitHub markdown
- [ ] AT-7: Content accurately reflects SPEC-GOVERNED-v5.md — no stale v4 claims, no fictional features

## Open Questions

- Q1: Should the page include the v1.1-specific sections (parallel turns, retry, preflight) or mark them as v1.1? **Decision: include them, mark with "(v1.1)" labels — the spec is the v1.1 spec.**
- Q2: Should we link back to the raw spec for sections that are too dense for HTML? **Decision: yes, include a "View full spec on GitHub" link in the hero.**
