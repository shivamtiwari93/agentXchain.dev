# Getting Started Tutorial Spec

## Purpose

Add a copy-paste getting-started guide that bridges the gap between the package-bound demo command and a first real governed run. The page must teach the real default mixed-mode scaffold honestly instead of assuming users can infer the operator loop from `quickstart` and `first-turn`.

## Interface

- New docs page: `website-v2/docs/getting-started.mdx`
- Sidebar entry between `quickstart` and `first-turn`
- Front-door links from:
  - `website-v2/docs/quickstart.mdx`
  - `website-v2/src/pages/launch.mdx`
  - manual adapter dispatch instructions in `cli/src/lib/adapters/manual-adapter.js`

## Behavior

- Teach the flow in this order:
  1. `npx --yes -p agentxchain@latest -c "agentxchain demo"`
  2. `npm install -g agentxchain`
  3. `agentxchain init --governed ...`
  4. `agentxchain step`
  5. `agentxchain approve-transition`
  6. `agentxchain step --role dev`
  7. `agentxchain step --role qa`
  8. `agentxchain approve-completion`
- State the truth boundary:
  - demo needs no API keys
  - the default scaffold is mixed-mode (`manual-pm`, `local-dev`, `api-qa`)
  - QA on the shipped default requires `ANTHROPIC_API_KEY` unless the operator changes `roles.qa.runtime` from `api-qa` to `manual-qa`
- Link deeper artifact detail to `/docs/first-turn`
- Explain the custom-phase workflow boundary:
  - `routing` controls phase order
  - `gates.requires_files` controls blocking files
  - explicit `workflow_kit` controls custom-phase artifact scaffolding and structural validation
  - `agentxchain init --governed --dir . -y` plus `agentxchain template validate` is the operator path after adding explicit `workflow_kit`
- Manual adapter instructions must point at the new getting-started guide, not only the narrower first-turn page
- The page must explain that bare `npx agentxchain ...` is not the truthful default for repeat usage

## Error Cases

- Do not present a full no-key real repo walkthrough if the default scaffold still needs an API key for QA.
- Do not imply `manual` and real-model proof are the same thing.
- Do not surface a getting-started page without guard tests; drift here will recreate the onboarding wall.

## Acceptance Tests

1. `website-v2/docs/getting-started.mdx` exists and is wired into `website-v2/sidebars.ts`.
2. The page includes the real command sequence from package-bound demo through `approve-completion`.
3. The page states the default runtime bindings, the `ANTHROPIC_API_KEY` requirement for default QA, and the built-in `manual-qa` fallback.
4. The page installs the CLI before switching to repeated bare `agentxchain ...` commands.
5. The page links to `/docs/first-turn` for artifact-level detail.
6. Manual adapter output includes gate hints, a turn-result example, a suggested next role, and the new `/docs/getting-started` link.
7. The page documents explicit `workflow_kit` for custom phases and the re-init plus `template validate` operator path.

## Open Questions

- None. The docs must describe the shipped default honestly rather than inventing a cleaner path.
