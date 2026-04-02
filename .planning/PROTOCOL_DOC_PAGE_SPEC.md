# Protocol Doc Page Spec

> Last updated: 2026-04-02 (Turn 7, Claude Opus 4.6)

---

## Purpose

Render the current governed protocol specification (`PROTOCOL-v6.md`) as a browsable, static HTML docs page at `/docs/protocol.html`, with a versioned permalink at `/docs/protocol-v6.html`. This is the normative reference for operators and adapter authors who need to understand the protocol contract without reading raw markdown on GitHub.

## Interface

- **Latest URL**: `/docs/protocol.html` → `website/docs/protocol.html`
- **Versioned URL**: `/docs/protocol-v6.html` → `website/docs/protocol-v6.html`
- **Stylesheet**: `website/docs.css` (shared)
- **Nav pattern**: Matches existing docs pages (quickstart, adapters, cli)
- **Sidebar**: "Docs" section links + "On this page" section anchors

## Page Structure

The page does NOT reproduce the spec verbatim. It reorganizes the spec content into a browsable reference with these sections:

1. **Overview** — What protocol v6 adds beyond v5
2. **Versioning** — v4/v5/v6 boundaries and latest-vs-versioned URLs
3. **Repo-Local Run** — The v5 single-repo layer that remains in force
4. **Coordinator Initiative** — `super_run_id`, repo linkage, projections, barriers
5. **Coordinator Config** — `agentxchain-multi.json` contract and allowed barrier types
6. **Coordinator Gates** — request/approval semantics for `multi step` and `multi approve-gate`
7. **Cross-Repo Context** — `COORDINATOR_CONTEXT.json`, `context_generated`, invalidations
8. **Coordinator Hooks** — four phases, blocking/advisory behavior, payload contract
9. **File Layout** — workspace and repo-local artifacts involved in multi-repo governance
10. **Compatibility** — how v6 coexists with v5 and legacy docs

## Behavior

- Static HTML, no JavaScript required
- `website/docs/protocol.html` is the latest stable alias for the current protocol version
- `website/docs/protocol-v6.html` is the immutable versioned permalink for v6
- All code examples use `<pre><code>` with inline styling consistent with docs.css
- JSON examples show real coordinator field names from implementation
- Internal cross-references use `#section-id` anchors
- External links point to `PROTOCOL-v6.md` and the historical `SPEC-GOVERNED-v5.md`

## Error Cases

- N/A (static page)

## Acceptance Tests

- [ ] AT-1: `website/docs/protocol.html` loads and identifies itself as protocol v6
- [ ] AT-2: `website/docs/protocol-v6.html` exists as the versioned permalink
- [ ] AT-3: Both pages link to `PROTOCOL-v6.md` on GitHub
- [ ] AT-4: The published docs mention `agentxchain-multi.json`, `multi approve-gate`, `context_generated`, and coordinator hooks
- [ ] AT-5: The docs no longer present `SPEC-GOVERNED-v5.md` as the current normative spec
- [ ] AT-6: Planning specs (`PROTOCOL_DOC_PAGE_SPEC.md`, `DOCS_SURFACE_SPEC.md`, `V2_SCOPE_BOUNDARY.md`) agree on the v6 surface
- [ ] AT-7: README-facing protocol links still resolve to explicit `.html` docs targets

## Open Questions

- Q1: Should `/docs/protocol.html` always be the latest alias, or should it freeze per major line and require explicit versioned docs selection? **Current decision: latest alias plus immutable versioned permalink.**
- Q2: When v7 ships, should `protocol-v6.html` remain verbatim or gain a historical banner linking to newer versions? **Open.**
