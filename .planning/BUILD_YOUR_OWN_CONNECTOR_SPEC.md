# Build Your Own Agent Connector — Tutorial Spec

## Purpose

A step-by-step tutorial that teaches an operator to build a minimal HTTP agent connector from scratch, wire it into AgentXchain governance, and prove it works — all in one executable path.

This tutorial sits one level deeper than the Integration Guide. The Integration Guide explains the three patterns and their contracts. This tutorial walks through building one.

## Interface

- **Public URL**: `/docs/build-your-own-connector`
- **Sidebar position**: Under the "Integration" category, after `adapters`
- **Prerequisites**: Node.js 18+, `agentxchain` CLI installed

## Behavior

The tutorial follows one concrete path:

1. **Create a minimal HTTP agent server** (Node.js, ~60 lines) that accepts a turn envelope and returns a valid turn-result JSON.
2. **Configure `agentxchain.json`** with a `remote_agent` runtime pointing at the server.
3. **Run a governed turn** using the connector.
4. **Verify** the turn was accepted through the governance pipeline.

The server handles two roles:
- `dev` → returns a `proposed` turn result with `proposed_changes[]`
- `qa` → returns a `review_only` turn result with `objections[]`

### What the tutorial does NOT cover
- MCP server pattern (separate tutorial if needed)
- `authoritative` write authority (not available for `remote_agent`)
- Model-backed connectors (the focus is the contract, not the AI)

## Error Cases

The tutorial explicitly teaches three validation traps:
1. **Bad decision IDs** — `DEC-CUSTOM-1` instead of `DEC-001` → rejection
2. **Missing objections on review_only** — challenge requirement fails
3. **Missing proposed_changes on proposed** — proposal apply has nothing to stage

## Acceptance Tests

- `AT-BYOC-001`: Tutorial page exists at `website-v2/docs/build-your-own-connector.mdx`
- `AT-BYOC-002`: Page documents the request envelope contract (run_id, turn_id, role, phase, prompt, context)
- `AT-BYOC-003`: Page documents the response contract (full turn-result schema)
- `AT-BYOC-004`: Page includes runnable server code (not pseudocode)
- `AT-BYOC-005`: Page includes `agentxchain.json` configuration example
- `AT-BYOC-006`: Page includes validation traps section with at least 3 traps
- `AT-BYOC-007`: Page is registered in sidebar under Integration category
- `AT-BYOC-008`: Page references the remote-agent-bridge example as the full proof artifact
- `AT-BYOC-009`: All code examples use `DEC-NNN` format decision IDs (not custom strings)
- `AT-BYOC-010`: No bare `npx agentxchain` commands (DEC-NPX-FD-001 compliance)
- `AT-BYOC-011`: The embedded `agentxchain.json` example validates through the real v4 config loader
- `AT-BYOC-012`: The page includes a governed bootstrap path (`agentxchain init --governed --dir . -y`) instead of assuming hidden repo setup
- `AT-BYOC-013`: The page explains both `verification.produced_files[].disposition` branches (`artifact` and `ignore`) and when to use each
- `AT-BYOC-014`: The page warns that undeclared verification outputs can strand acceptance/checkpoint/resume by leaving actor-owned dirt outside the accepted turn contract

## Open Questions

None. The contract is well-defined by existing adapter code and the integration guide.
