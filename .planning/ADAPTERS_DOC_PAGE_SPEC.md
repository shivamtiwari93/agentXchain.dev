# Adapters Documentation Page Spec

> Spec-driven: written before implementation per DEC-DOCS-001.

---

## Purpose

Public documentation page at `/docs/adapters` explaining how AgentXchain's five adapter types work, what contract they share, what each one does differently, and how to implement a new adapter. Target audience: developers evaluating AgentXchain or building a custom integration.

## Interface

- **URL**: `https://agentxchain.dev/docs/adapters/`
- **File**: `website-v2/docs/adapters.mdx` (Docusaurus source)
- **Stylesheet**: `website-v2/src/css/custom.css` (Docusaurus theme)
- **Nav/sidebar**: Wired via `website-v2/sidebars.ts`, cross-linked with quickstart and landing page

## Page Structure

### 1. Hero
- Eyebrow: "Docs / Adapters"
- Headline: What adapters are and why they exist (transport layer between orchestrator and agent runtimes)
- Lede: Adapters are intentionally thin — ~200 lines each. The orchestrator handles governance; adapters handle delivery.

### 2. Shared Contract
- 3-phase lifecycle: dispatch → wait → collect
- Filesystem contract table (dispatch paths, staging paths, reserved paths)
- Core rules: adapters don't write state, don't validate, don't route

### 3. Manual Adapter
- How it works: prints instructions, operator does the work, stages result manually
- Dispatch: filesystem-based (reads PROMPT.md, CONTEXT.md)
- Wait: polls `.agentxchain/staging/<turn_id>/turn-result.json` every 2s
- When to use: learning the protocol, human-authored turns, PM roles

### 4. Local CLI Adapter
- How it works: spawns a subprocess (Claude Code, Codex, Aider, any CLI)
- Prompt transport modes: `argv`, `stdin`, `dispatch_bundle_only`
- Timeout handling: SIGTERM → 10s grace → SIGKILL
- When to use: automated dev turns with local coding agents

### 5. API Proxy Adapter
- How it works: HTTP call to model provider (supports Anthropic, OpenAI, and Google Gemini; `base_url` override available)
- Write authority restriction: `review_only` and `proposed` only in v1
- Retry logic: exponential backoff with jitter
- Preflight tokenization: prevents wasted API calls; `provider_local` remains limited to providers with shipped tokenizer support
- Cost tracking: provider telemetry is authoritative
- Audit artifacts: API_REQUEST.json, TOKEN_BUDGET.json, CONTEXT.effective.md
- Error classification taxonomy
- When to use: QA/review turns, lightweight review, cost-tracked automation

### 6. MCP Adapter
- How it works: synchronous governed turn dispatch through a governed MCP tool contract
- Transport support: `stdio` and `streamable_http`
- Write authority restriction: same bounded non-authoritative support as the shipped connector contract
- When to use: protocol-compatible external agent runtimes that already expose an MCP surface

### 7. Remote Agent Adapter
- How it works: synchronous HTTP dispatch of a governed turn envelope to an external agent service
- Write authority restriction: `review_only` and `proposed` only in v1
- When to use: non-local agent services that implement the AgentXchain turn-result contract

### 8. Implementing a New Adapter
- What to implement (dispatch, wait, collect)
- What to read (dispatch bundle)
- What to write (staging result)
- What NOT to do (write state, validate, route)
- Minimal checklist

### 9. Comparison Table
- Side-by-side: transport, write authority, dispatch mechanism, wait mechanism, timeout, retry, audit artifacts

## Behavior

- Static HTML, same design system as quickstart
- No JavaScript required
- Responsive (single-column on mobile)
- All code examples use real file paths and real JSON schemas from the protocol

## Error Cases

- N/A (static page)

## Status

**Status:** Shipped

## Acceptance Tests

- [x] Page loads at `/docs/adapters` with no JS errors — **dropped**: Docusaurus SSR guarantees no-JS rendering; this is a framework property, not application behavior
- [x] All five adapters documented with accurate dispatch/wait/collect mechanics
- [x] Public enumerations use the canonical shipped adapter order: `manual`, `local_cli`, `api_proxy`, `mcp`, `remote_agent`
- [x] Shared contract section present with filesystem table
- [x] "Implementing a new adapter" section with concrete checklist
- [x] Comparison table matches actual adapter capabilities
- [x] API proxy provider examples and prose match the supported provider allowlist in config validation
- [x] Cross-links: sidebar links to quickstart, protocol spec, CLI spec
- [x] Footer matches quickstart footer — **dropped**: Docusaurus shared layout guarantees footer parity across all pages; this is a framework property, not application behavior
- [x] Page is responsive at 768px and 375px widths — **dropped**: Docusaurus theme ships responsive CSS by default; testing viewport widths requires browser automation (Playwright) that doesn't exist in the test infra, and this is a framework property, not application behavior
- [x] No stale references to legacy commands, PROJECT.md, REQUIREMENTS.md, or lock-based workflow

## Open Questions

- Should we include the full error classification taxonomy or link to the protocol spec for that level of detail?
- Should we show the full turn-result JSON schema on this page or reference the quickstart/protocol spec?
