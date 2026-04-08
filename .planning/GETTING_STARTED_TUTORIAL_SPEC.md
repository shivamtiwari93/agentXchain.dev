# Getting Started Tutorial Spec

## Purpose

Add a copy-paste getting-started guide that bridges the gap between `npx agentxchain demo` and a first real governed run. The page must teach the real default mixed-mode scaffold honestly instead of assuming users can infer the operator loop from `quickstart` and `first-turn`.

## Interface

- New docs page: `website-v2/docs/getting-started.mdx`
- Sidebar entry between `quickstart` and `first-turn`
- Front-door links from:
  - `website-v2/docs/quickstart.mdx`
  - `website-v2/src/pages/launch.mdx`
  - manual adapter dispatch instructions in `cli/src/lib/adapters/manual-adapter.js`

## Behavior

- Teach the flow in this order:
  1. `npx agentxchain demo`
  2. `npx agentxchain init --governed ...`
  3. `agentxchain step`
  4. `agentxchain approve-transition`
  5. `agentxchain step --role dev`
  6. `agentxchain step --role qa`
  7. `agentxchain approve-completion`
- State the truth boundary:
  - demo needs no API keys
  - the default scaffold is mixed-mode (`manual-pm`, `local-dev`, `api-qa`)
  - QA on the shipped default requires `ANTHROPIC_API_KEY` unless the operator rebinds QA to a manual runtime
- Link deeper artifact detail to `/docs/first-turn`
- Manual adapter instructions must point at the new getting-started guide, not only the narrower first-turn page

## Error Cases

- Do not present a full no-key real repo walkthrough if the default scaffold still needs an API key for QA.
- Do not imply `manual` and real-model proof are the same thing.
- Do not surface a getting-started page without guard tests; drift here will recreate the onboarding wall.

## Acceptance Tests

1. `website-v2/docs/getting-started.mdx` exists and is wired into `website-v2/sidebars.ts`.
2. The page includes the real command sequence from demo through `approve-completion`.
3. The page states the default runtime bindings and the `ANTHROPIC_API_KEY` requirement for default QA.
4. The page links to `/docs/first-turn` for artifact-level detail.
5. Manual adapter output includes gate hints, a turn-result example, a suggested next role, and the new `/docs/getting-started` link.

## Open Questions

- None. The docs must describe the shipped default honestly rather than inventing a cleaner path.
