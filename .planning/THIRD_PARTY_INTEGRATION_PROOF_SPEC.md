# Third-Party Integration Proof — Spec

## Purpose

Create a public docs page and evidence contract proving that AgentXchain can govern any external agent runtime — not just its own built-in adapters and examples. The proof surface should demonstrate three integration patterns and serve as both evidence and an operator guide.

## Interface

### Public surface

- `website-v2/docs/integration-guide.mdx` — docs page accessible at `/docs/integration-guide`
- Sidebar entry under a new "Integration" category alongside `adapters` and existing protocol docs

### Evidence contract

The page must present real, verified evidence for each integration pattern. Claims must be guard-enforced.

## Behavior

### Three integration patterns

1. **HTTP Remote Agent** — Any HTTP service implementing the turn-result JSON contract can be governed. Evidence: model-backed bridge proof (Claude Haiku over HTTP → governed acceptance pipeline).
2. **MCP Server** — Any MCP server exposing the `agentxchain_turn` tool can be governed. Evidence: mcp-anthropic-agent (real Claude via MCP stdio).
3. **API Proxy** — Direct LLM API calls through the built-in multi-provider adapter. Evidence: three-provider proof (Anthropic + OpenAI + Google Gemini).

### Content structure

1. **Introduction** — AgentXchain governs the workflow, not the agent. Any agent that can return structured JSON is governable.
2. **Pattern 1: HTTP Remote Agent** — how it works, config example, what you build, what AgentXchain enforces, proof evidence.
3. **Pattern 2: MCP Server** — same structure.
4. **Pattern 3: API Proxy** — same structure.
5. **Choosing a pattern** — decision matrix: when to use which.
6. **What AgentXchain enforces regardless of pattern** — schema validation, challenge requirements, phase gates, decision ledger, proposal/review authority boundaries.
7. **Common validation traps** — the real failure modes from model-backed proof (decision IDs, empty objections, missing proposed_changes).

### Key invariant

Every claim on the page must be backed by shipped proof in the repo. No aspirational language, no "coming soon," no capability claims without executable evidence.

The page must also separate:

- **Supported contract surface** — what the runtime/config layer allows today
- **Shipped public proof** — what examples, reports, and tests have actually proven

Do not blur those two. A broader contract surface is not the same thing as a broader proof surface.

## Error Cases

- Page references a proof artifact that does not exist → test guard fails
- Page claims a pattern that has no E2E proof → test guard fails
- Page teaches commands that violate `DEC-NPX-FD-001` → existing front-door guard catches it

## Acceptance Tests

- `AT-TPI-001`: Integration guide page exists at `website-v2/docs/integration-guide.mdx`
- `AT-TPI-002`: Page documents all three integration patterns (remote_agent, mcp, api_proxy)
- `AT-TPI-003`: Page references real proof artifacts (model-backed server, mcp-anthropic-agent, multi-provider proof)
- `AT-TPI-004`: Page includes validation traps section
- `AT-TPI-005`: Page is registered in sidebars.ts
- `AT-TPI-006`: Docusaurus build succeeds with the new page
- `AT-TPI-007`: sitemap.xml includes the integration-guide URL
- `AT-TPI-008`: llms.txt includes the integration-guide URL
- `AT-TPI-009`: Write-authority guidance matches runtime truth: `remote_agent` and `api_proxy` support `review_only`/`proposed`; `mcp` may back `authoritative`, `proposed`, and `review_only`
- `AT-TPI-010`: Numeric proof claims (for example `5/5`, `100%`) match the shipped report artifacts or are removed
- `AT-TPI-011`: MCP section distinguishes contract support from the narrower shipped public proof surface

## Open Questions

- Should the integration guide link to a "Build Your Own Connector" tutorial? Deferred — the guide itself is the priority. A tutorial can be added later if operator feedback demands it.
