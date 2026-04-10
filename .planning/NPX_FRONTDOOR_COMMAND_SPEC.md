# Front-Door Package Invocation Spec

## Purpose

Keep the public install and evaluation surface honest when `agentxchain` already exists on `PATH`.

The shorthand `npx agentxchain ...` is not a truthful front-door command in environments that already have an older `agentxchain` binary installed. The safe zero-install path is a package-bound invocation. The safe repeated-usage path is to install the CLI once, then use `agentxchain ...` directly.

## Interface

- Front-door docs and landing surfaces:
  - `README.md`
  - `cli/README.md`
  - `website-v2/src/pages/index.tsx`
  - `website-v2/docs/quickstart.mdx`
  - `website-v2/docs/getting-started.mdx`
  - `website-v2/docs/tutorial.mdx`
  - `website-v2/docs/first-turn.mdx`
  - `website-v2/docs/templates.mdx`
- Planning specs that define those surfaces:
  - `.planning/DEMO_FRONTDOOR_ADOPTION_SPEC.md`
  - `.planning/GETTING_STARTED_TUTORIAL_SPEC.md`
  - `.planning/QUICKSTART_DOC_PAGE_SPEC.md`
  - `.planning/TUTORIAL_WALKTHROUGH_SPEC.md`
- Guard:
  - `cli/test/frontdoor-install-surface.test.js`

## Behavior

1. The zero-install demo command is:

   ```bash
   npx --yes -p agentxchain@latest -c "agentxchain demo"
   ```

2. Front-door walkthroughs that expect repeated commands must install the CLI first:

   ```bash
   npm install -g agentxchain
   agentxchain --version
   ```

3. After install, walkthroughs should use `agentxchain ...` directly instead of repeating package-bound `npx` for every step.

4. Front-door surfaces must not advertise bare `npx agentxchain demo` or bare `npx agentxchain init ...` as the default command path.

## Error Cases

- Do not tell users to scaffold with a one-off `npx` command and then immediately switch to bare `agentxchain` unless the page also installs the CLI first.
- Do not treat the shorthand `npx agentxchain ...` as equivalent to the package-bound form. It is not.
- Do not scope this only to release tooling. This is a user-facing adoption surface, not just an operator postflight nuance.

## Acceptance Tests

- `AT-NPX-FD-001`: front-door surfaces use the package-bound demo command.
- `AT-NPX-FD-002`: front-door walkthroughs that expect repeated commands include `npm install -g agentxchain`.
- `AT-NPX-FD-003`: front-door surfaces do not reintroduce bare `npx agentxchain demo`.
- `AT-NPX-FD-004`: front-door surfaces do not reintroduce bare `npx agentxchain init`.

## Open Questions

- None. The command boundary is concrete and already observable.
