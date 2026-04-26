## Purpose

Add an honest public comparison page for `AgentXchain vs Warp.dev` that explains product-boundary differences without pretending Warp and AgentXchain are the same category.

## Interface

- Page: `website-v2/docs/compare/vs-warp.mdx`
- Navigation updates:
  - `website-v2/docusaurus.config.ts`
  - `website-v2/src/pages/index.tsx`

Source-backed claim boundary now lives in `.planning/COMPARE_WARP_CLAIMS_SPEC.md`.

## Behavior

- The page must follow the existing comparison-page format:
  - short answer
  - comparison table
  - choose-X sections
  - concrete workflow difference
  - using both together
  - verify the claims
- The comparison must stay grounded in Warp's actual product surface from official docs:
  - AI-native terminal and coding workflow
  - agent profiles and permissions
  - Full Terminal Use
  - Warp Drive / `AGENTS.md` rules
  - session sharing / agent session sharing
  - Oz CLI / cloud agents / environments / MCP
- The comparison must not claim Warp provides governed multi-role software-delivery protocol semantics that it does not document.
- The comparison must not pretend AgentXchain replaces Warp as a terminal or coding environment.

## Error Cases

- Strawman copy that ignores Warp's real agent, collaboration, or cloud-run capabilities
- Nav drift where the page exists but is missing from navbar, footer, or homepage comparison CTA
- Claims that imply a shipped first-party AgentXchain-to-Warp integration that does not exist

## Acceptance Tests

- `website-v2/docs/compare/vs-warp.mdx` exists and matches the established comparison-page pattern
- Compare navigation includes `vs Warp.dev`
- Homepage comparison CTA includes `vs Warp.dev`
- `cd website-v2 && npm run build` succeeds with the new page

## Open Questions

- None for the page itself. Separate roadmap work will determine which additional comparison pages should exist next.

## Official Research Inputs

- `https://www.warp.dev/pricing`
- `https://docs.warp.dev/getting-started/readme/coding-in-warp`
- `https://docs.warp.dev/agents/full-terminal-use`
- `https://docs.warp.dev/knowledge-and-collaboration/session-sharing/agent-session-sharing`
- `https://docs.warp.dev/agent-platform/cloud-agents/mcp`
- `https://docs.warp.dev/reference/cli/cli`
- `https://docs.warp.dev/agent-platform/capabilities/model-choice`
