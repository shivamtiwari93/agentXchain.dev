# Generic Template Manual Baseline Spec

## Purpose

Make the default `generic` governed scaffold a true zero-dependency starting point for first-time operators. `agentxchain init --governed -y` should let someone explore the governance flow without requiring `ANTHROPIC_API_KEY` or a local coding CLI before the first turn.

## Interface

- Default command path: `agentxchain init --governed -y`
- Template surface: `cli/src/templates/governed/generic.json`
- Scaffold implementation: `cli/src/commands/init.js`
- Public docs:
  - `website-v2/docs/quickstart.mdx`
  - `website-v2/docs/getting-started.mdx`
  - `website-v2/docs/tutorial.mdx`
  - `website-v2/docs/templates.mdx`

## Behavior

1. The default `generic` template is manual-first:
   - `pm` uses `manual-pm`
   - `dev` uses `manual-dev`
   - `qa` uses `manual-qa`
   - `eng_director` uses `manual-director`
2. The default scaffold created by `init --governed -y` must therefore require no API key and no local coding CLI to pass the first-run readiness path.
3. Built-in project templates such as `cli-tool`, `web-app`, and `api-service` remain mixed-mode unless their own manifests say otherwise.
4. `manual-dev` becomes a built-in runtime entry for the non-generic templates too, so operators can rebind `roles.dev.runtime` without first adding a new runtime object by hand.
5. If the operator explicitly passes `--dev-command` or `--dev-prompt-transport` while using the `generic` template, that explicit request upgrades `dev` back to `local-dev` instead of being silently ignored.
6. Init output should distinguish a manual-only generic scaffold from mixed-mode project templates.

## Error Cases

- Do not keep calling the default scaffold "mixed-mode" once `generic` is manual-only.
- Do not silently ignore explicit `--dev-command` / `--dev-prompt-transport` on the generic template.
- Do not change non-generic project templates to manual-only as collateral damage.

## Acceptance Tests

- `AT-GENERIC-MANUAL-001`: `agentxchain init --governed -y` writes `template: "generic"` with `manual-pm`, `manual-dev`, and `manual-qa` as the active role runtimes.
- `AT-GENERIC-MANUAL-002`: a default generic scaffold passes `agentxchain doctor --json` without `ANTHROPIC_API_KEY`.
- `AT-GENERIC-MANUAL-003`: project-template docs distinguish manual-only `generic` from mixed-mode templates like `cli-tool`.
- `AT-GENERIC-MANUAL-004`: tutorial docs stop telling operators to add `runtimes.manual-dev.type manual`; the built-in runtime already exists.
- `AT-GENERIC-MANUAL-005`: explicit `--dev-command` on `generic` rebinds `roles.dev.runtime` to `local-dev`.

## Open Questions

- None. The default baseline should optimize for cold-start governance exploration, while project-specific templates remain the opt-in path for mixed-mode realism.
