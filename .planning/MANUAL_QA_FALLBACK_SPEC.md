## Purpose

Make the default governed scaffold honest for no-key evaluation after the planning and dev turns.

Today the scaffold ships `qa` bound to `api-qa`, but the first-run docs and recovery text only say "rebind QA to a manual runtime" without giving operators a first-party target to switch to. The product should ship a built-in manual QA fallback and point to the exact config edit when `ANTHROPIC_API_KEY` is missing.

## Interface

- Governed `init` scaffolds a `manual-qa` runtime alongside `manual-pm`, `local-dev`, `api-qa`, and `manual-director`.
- `roles.qa.runtime` remains `api-qa` by default.
- `init --governed` output names the built-in fallback when required API credentials are missing.
- `agentxchain step` dispatch failure output for missing QA API credentials points to the exact config edit:
  - change `roles.qa.runtime` from `api-qa` to `manual-qa`
  - rerun `agentxchain step --resume`
- Public onboarding docs name `manual-qa` explicitly instead of vague "manual runtime" language.

## Behavior

1. A fresh governed scaffold includes:
   - `"manual-qa": { "type": "manual" }` under `runtimes`
   - `"qa": { ..., "runtime": "api-qa" }` under `roles`
2. If `ANTHROPIC_API_KEY` is missing during `init --governed`, the readiness hint still says the scaffold is mixed-mode, but it also tells the operator the truthful no-key fallback: set `roles.qa.runtime` to `manual-qa`.
3. If a QA `api_proxy` turn fails because `ANTHROPIC_API_KEY` is missing, `step` prints the exact fallback edit and the getting-started docs link in addition to the normal blocked-state recovery commands.
4. This guidance is narrow:
   - only for `missing_credentials`
   - only for the QA role
   - only when the scaffold actually has a `manual-qa` runtime

## Error Cases

- Do not claim the scaffold is fully no-key end to end by default. `qa` remains bound to `api-qa` unless the operator changes it.
- Do not print the `manual-qa` fallback for non-QA roles or unrelated API failures.
- Do not add a fallback command that does not exist. The recovery must point to an exact `agentxchain.json` edit.

## Acceptance Tests

- `init --governed` writes `runtimes.manual-qa.type === "manual"` in `agentxchain.json`.
- `init --governed` output mentions `manual-qa` when `ANTHROPIC_API_KEY` is absent.
- `agentxchain step` on a QA `api_proxy` turn without `ANTHROPIC_API_KEY` mentions:
  - `ANTHROPIC_API_KEY`
  - `manual-qa`
  - `roles.qa.runtime`
  - `agentxchain step --resume`
  - `https://agentxchain.dev/docs/getting-started`
- `website-v2/docs/getting-started.mdx` and `website-v2/docs/first-turn.mdx` name `manual-qa` as the built-in no-key fallback.

## Open Questions

- None. This is a narrow scaffold and messaging correction, not a workflow-model change.
