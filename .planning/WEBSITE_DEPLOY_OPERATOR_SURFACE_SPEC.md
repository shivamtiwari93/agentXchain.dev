> Keep operator-facing automation prompts truthful about the shipped website deployment surface.

# Website Deploy Operator Surface Spec

## Purpose

Prevent operator drift across repo-native automation surfaces. The canonical production path for `agentxchain.dev` is GitHub Actions, not a removed local helper script. Any automation prompt that tells agents how to publish website/docs changes must point at the real deployment contract.

## Interface

- `run-agents.sh`
- `.github/workflows/deploy-gcs.yml`
- `.github/workflows/deploy-pages.yml`

## Behavior

1. `run-agents.sh` must describe `.github/workflows/deploy-gcs.yml` as the canonical production deploy path for `https://agentxchain.dev`.
2. `run-agents.sh` must describe `.github/workflows/deploy-pages.yml` as the mirror path.
3. `run-agents.sh` may mention `gh workflow run` / `workflow_dispatch` for manual reruns.
4. `run-agents.sh` must not tell operators to run `deploy-websites.sh` or another missing local helper.

## Error Cases

- Automation prompt references a deleted local deploy helper.
- Automation prompt names only one workflow and hides the production/mirror split.
- Automation prompt implies deployment requires a repo-local script when the supported contract is GitHub Actions.

## Acceptance Tests

1. `run-agents.sh` mentions `.github/workflows/deploy-gcs.yml`.
2. `run-agents.sh` mentions `.github/workflows/deploy-pages.yml`.
3. `run-agents.sh` mentions `gh workflow run` or `workflow_dispatch`.
4. `run-agents.sh` does not mention `deploy-websites.sh`.

## Open Questions

- None.
