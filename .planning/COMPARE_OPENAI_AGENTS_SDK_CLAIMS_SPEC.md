# Compare vs OpenAI Agents SDK — Claim Boundary Spec

## Purpose

Guard the public `vs-openai-agents-sdk.mdx` comparison page and `COMPETITIVE_POSITIONING_MATRIX.md` against stale shorthand that understates the OpenAI Agents SDK's current capabilities.

## Governed Surfaces

- `website-v2/src/pages/compare/vs-openai-agents-sdk.mdx`
- `.planning/COMPETITIVE_POSITIONING_MATRIX.md` (OpenAI Agents SDK row)

## Interface

- `.planning/COMPARE_OPENAI_AGENTS_SDK_CLAIMS_SPEC.md` (this file)
- `cli/test/compare-openai-agents-sdk-claims.test.js`

## Required Acknowledgments (source-backed)

The comparison page must acknowledge these current OpenAI Agents SDK capabilities:

1. **MCP support** — 4 transports: hosted (`HostedMCPTool`), Streamable HTTP, SSE, stdio. Source: official MCP docs page.
2. **Sandbox agents** — container-based agents for long-running tasks. Source: official sandbox agents docs.
3. **Hosted tools** — web search, file search, code interpreter, image generation, computer use. Source: official tools docs.
4. **Realtime voice agents** — beta, `gpt-realtime-1.5`. Source: official realtime agents docs.
5. **Tracing integrations** — built-in tracing with 25+ external integrations. Source: official tracing docs.
6. **Session backends** — 9+ storage backends (SQLite, Redis, SQLAlchemy, Dapr, encrypted, etc.). Source: official sessions docs.
7. **Durable execution** — integrations with Temporal, Restate, DBOS. Source: official running agents docs.
8. **Guardrails** — input, output, and tool-level guardrails. Source: official guardrails docs.
9. **Serializable RunState** — `to_json()`/`from_json()` for durable HITL. Source: official HITL docs.

## Rejection Rules

The comparison page must NOT:

- Reduce the SDK to "lightweight primitives" — it is now a broad framework
- Omit MCP support when listing SDK capabilities
- Omit sandbox agents or hosted tools
- Present tracing as a basic feature without acknowledging the 25+ integration ecosystem
- Present sessions without acknowledging multiple backend options

## Acceptance Tests

- `AT-OAI-001`: Short answer names MCP, sandbox agents, hosted tools, realtime voice agents, durable execution
- `AT-OAI-002`: Comparison table workflow-model row names MCP, sandbox agents, hosted tools, realtime
- `AT-OAI-003`: Tracing row acknowledges 25+ integrations
- `AT-OAI-004`: Page does not reduce SDK to "lightweight primitives" as the framing
- `AT-OAI-005`: Matrix row acknowledges MCP, sandbox agents, hosted tools, durable execution

## Sources

- OpenAI Agents SDK intro: https://openai.github.io/openai-agents-python/
- OpenAI Agents SDK HITL: https://openai.github.io/openai-agents-python/human_in_the_loop/
- OpenAI Agents SDK tracing: https://openai.github.io/openai-agents-python/tracing/
- OpenAI Agents SDK sessions: https://openai.github.io/openai-agents-python/sessions/
- OpenAI Agents SDK guardrails: https://openai.github.io/openai-agents-python/guardrails/
- OpenAI Agents SDK running agents: https://openai.github.io/openai-agents-python/running_agents/
- OpenAI Agents SDK multi-agent: https://openai.github.io/openai-agents-python/multi-agent/
- OpenAI Agents SDK repo: https://github.com/openai/openai-agents-python

## Decision

- `DEC-OPENAI-AGENTS-SDK-COMPARE-CLAIMS-001`: Comparison surfaces must acknowledge current official OpenAI Agents SDK capabilities: MCP (4 transports), sandbox agents, hosted tools (web search, file search, code interpreter, image generation, computer use), realtime voice agents, tracing with 25+ integrations, sessions with 9+ backends, durable execution integrations (Temporal, Restate, DBOS), and serializable `RunState`. The product contrast remains missing repository-delivery governance, decision-ledger semantics, and built-in cross-repo coordination.
