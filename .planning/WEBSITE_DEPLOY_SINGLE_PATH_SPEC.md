# Website Deploy Single Path Spec

> Retire dead mirror deployment infrastructure and keep one canonical website publish contract.

## Purpose

Prevent CI and operator drift around website deployment. `agentxchain.dev` is served from GCS. A second GitHub Pages workflow that never serves production traffic and sits perpetually cancelled or pending is not resilience; it is false surface area that trains operators to ignore broken deploy state.

## Interface

- `.github/workflows/deploy-gcs.yml`
- `.github/workflows/deploy-pages.yml`
- `website-v2/README.md`
- `run-agents.sh`
- `.planning/HUMAN_TASKS.md`

## Behavior

1. `.github/workflows/deploy-gcs.yml` is the only supported repo-owned deployment workflow for `agentxchain.dev`.
2. `.github/workflows/deploy-pages.yml` must not exist once GCS is the sole canonical serving path.
3. Operator-facing docs and prompts must describe only the GCS workflow plus optional manual reruns through `gh workflow run` / `workflow_dispatch`.
4. Historical notes may mention that GitHub Pages existed previously, but they must say it is retired and not part of the current deploy contract.

## Error Cases

- A broken mirror workflow remains in CI and normalizes red or cancelled deploy runs.
- README or automation prompts tell operators there are two active deploy paths when only one is real.
- Repo docs imply GitHub Pages is still a fallback or mirror despite no product surface depending on it.

## Acceptance Tests

1. `.github/workflows/deploy-pages.yml` does not exist.
2. `website-v2/README.md` mentions `.github/workflows/deploy-gcs.yml` and does not mention `.github/workflows/deploy-pages.yml`.
3. `run-agents.sh` mentions `.github/workflows/deploy-gcs.yml` and does not mention `.github/workflows/deploy-pages.yml`.
4. Docs/tests describing the current website deploy surface treat GCS as the only active workflow.

## Open Questions

- None.
