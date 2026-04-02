# Adapters Documentation Page Spec

> Spec-driven: written before implementation per DEC-DOCS-001.

---

## Purpose

Public documentation page at `/docs/adapters` explaining how AgentXchain's three adapter types work, what contract they share, what each one does differently, and how to implement a new adapter. Target audience: developers evaluating AgentXchain or building a custom integration.

## Interface

- **URL**: `https://agentxchain.dev/docs/adapters`
- **File**: `website/docs/adapters.html`
- **Stylesheet**: `website/docs.css` (shared with quickstart)
- **Nav/sidebar**: Cross-linked with quickstart and landing page

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
- How it works: HTTP call to model provider (Anthropic v1)
- Write authority restriction: review_only roles only in v1
- Retry logic: exponential backoff with jitter
- Preflight tokenization: prevents wasted API calls
- Cost tracking: provider telemetry is authoritative
- Audit artifacts: API_REQUEST.json, TOKEN_BUDGET.json, CONTEXT.effective.md
- Error classification taxonomy
- When to use: QA/review turns, lightweight review, cost-tracked automation

### 6. Implementing a New Adapter
- What to implement (dispatch, wait, collect)
- What to read (dispatch bundle)
- What to write (staging result)
- What NOT to do (write state, validate, route)
- Minimal checklist

### 7. Comparison Table
- Side-by-side: transport, write authority, dispatch mechanism, wait mechanism, timeout, retry, audit artifacts

## Behavior

- Static HTML, same design system as quickstart
- No JavaScript required
- Responsive (single-column on mobile)
- All code examples use real file paths and real JSON schemas from the protocol

## Error Cases

- N/A (static page)

## Acceptance Tests

- [ ] Page loads at `/docs/adapters` with no JS errors
- [ ] All three adapters documented with accurate dispatch/wait/collect mechanics
- [ ] Shared contract section present with filesystem table
- [ ] "Implementing a new adapter" section with concrete checklist
- [ ] Comparison table matches actual adapter capabilities
- [ ] Cross-links: sidebar links to quickstart, protocol spec, CLI spec
- [ ] Footer matches quickstart footer
- [ ] Page is responsive at 768px and 375px widths
- [ ] No stale references to legacy commands, PROJECT.md, REQUIREMENTS.md, or lock-based workflow

## Open Questions

- Should we include the full error classification taxonomy or link to the protocol spec for that level of detail?
- Should we show the full turn-result JSON schema on this page or reference the quickstart/protocol spec?
