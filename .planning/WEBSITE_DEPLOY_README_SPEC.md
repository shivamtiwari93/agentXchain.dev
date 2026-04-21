# Website Deploy README Spec

> Keep `website-v2/README.md` truthful about the shipped website deployment surface.

---

## Purpose

Prevent operator drift around website deployment. The repo currently deploys the Docusaurus build through GitHub Actions workflows, not an ad hoc local helper script. The website README must describe the real entry points an operator can rely on.

## Interface

Covered files:

- `website-v2/README.md`
- `.github/workflows/deploy-gcs.yml`

## Behavior

The README must:

1. Describe `Deploy Website to GCP GCS` (`.github/workflows/deploy-gcs.yml`) as the canonical deployment path for `https://agentxchain.dev`.
2. State that the workflow triggers on pushes to `main` that touch `website-v2/**` or `docs/**`.
3. State that the workflow also supports manual `workflow_dispatch`.
4. Avoid telling operators to run `deploy-websites.sh` when that script is not part of the repo-owned deployment contract.
5. Avoid describing GitHub Pages as an active deployment path when it is retired.

## Error Cases

- README points to `deploy-websites.sh` or another missing local helper as the primary deploy path.
- README omits the canonical GCS workflow.
- README implies GitHub Pages is still a live mirror deployment surface.
- README invents trigger behavior that does not match the workflow files.

## Acceptance Tests

1. `website-v2/README.md` mentions `.github/workflows/deploy-gcs.yml`.
2. `website-v2/README.md` mentions both `main` and `workflow_dispatch`.
3. `website-v2/README.md` does not mention `.github/workflows/deploy-pages.yml`.
4. `website-v2/README.md` does not mention `deploy-websites.sh`.
5. `.github/workflows/deploy-gcs.yml` declares `workflow_dispatch`.

## Open Questions

1. Should the repo add a documented manual `gh workflow run` example for deploy recovery, or is naming the workflow files enough?
