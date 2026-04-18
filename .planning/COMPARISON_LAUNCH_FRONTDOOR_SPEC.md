# Comparison And Launch Front-Door Spec

## Purpose

Keep comparison pages and the `/launch` page aligned with the governed-ready onboarding contract. Visitors arriving from competitor research or launch traffic should see the current real-repo path, not stale bare-init scaffolding.

## Interface

Public surfaces:

- `website-v2/docs/compare/vs-crewai.mdx`
- `website-v2/docs/compare/vs-langgraph.mdx`
- `website-v2/docs/compare/vs-openai-agents-sdk.mdx`
- `website-v2/docs/compare/vs-autogen.mdx`
- `website-v2/docs/compare/vs-warp.mdx`
- `website-v2/docs/compare/vs-devin.mdx`
- `website-v2/docs/compare/vs-metagpt.mdx`
- `website-v2/docs/compare/vs-codegen.mdx`
- `website-v2/docs/compare/vs-openhands.mdx`
- `website-v2/src/pages/launch.mdx`

Guard surfaces:

- `cli/test/comparison-pages-content.test.js`
- `cli/test/launch-page-content.test.js`

## Behavior

- Comparison pages that show the AgentXchain workflow must route readers through a mission-aware scaffold command using `agentxchain init --governed --goal "..."` instead of bare `agentxchain init --governed`.
- Those comparison-page workflow snippets must include `agentxchain doctor` before `run` so the public path matches the governed-readiness contract.
- The launch page "Get started" block must keep the demo-first path, then show the real governed bootstrap with `--goal` and `agentxchain doctor`.
- None of these public surfaces may present bare `agentxchain init --governed` as the recommended repo bootstrap path.

## Error Cases

- A comparison page says "install, init, run" without `--goal`.
- A comparison page skips `agentxchain doctor` and implies the operator should run a governed workflow blindly.
- The launch page mixes the demo-first path with a stale bare-init repo setup path.
- Guard tests only check that a code block exists, allowing stale onboarding commands to creep back in.

## Acceptance Tests

- `AT-CLFD-001`: all comparison pages with AgentXchain workflow snippets include `agentxchain init --governed --goal` and `agentxchain doctor`.
- `AT-CLFD-002`: comparison pages do not retain bare `agentxchain init --governed` as a standalone recommended command.
- `AT-CLFD-003`: `website-v2/src/pages/launch.mdx` keeps the package-bound demo command and the governed-ready repo bootstrap path with `--goal` and `agentxchain doctor`.
- `AT-CLFD-004`: `cli/test/comparison-pages-content.test.js` and `cli/test/launch-page-content.test.js` guard the new front-door contract.

## Open Questions

- None.
