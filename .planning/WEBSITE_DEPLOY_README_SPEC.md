# Website Deploy README Spec

> Keep `website-v2/README.md` truthful about the shipped website deployment surface.

---

## Purpose

Prevent operator drift around website deployment. The repo currently deploys the Docusaurus build through GitHub Actions workflows, not an ad hoc local helper script. The website README must describe the real entry points an operator can rely on.

## Interface

Covered files:

- `website-v2/README.md`
- `.github/workflows/deploy-gcs.yml`
- `.github/workflows/deploy-pages.yml`

## Behavior

The README must:

1. Describe `Deploy Website to GCP GCS` (`.github/workflows/deploy-gcs.yml`) as the canonical deployment path for `https://agentxchain.dev`.
2. Describe `Deploy Website to GitHub Pages` (`.github/workflows/deploy-pages.yml`) as the mirror deployment path.
3. State that both workflows trigger on pushes to `main` that touch `website-v2/**`.
4. State that both workflows also support manual `workflow_dispatch`.
5. Avoid telling operators to run `deploy-websites.sh` when that script is not part of the repo-owned deployment contract.

## Error Cases

- README points to `deploy-websites.sh` or another missing local helper as the primary deploy path.
- README omits the canonical GCS workflow.
- README implies GitHub Pages is the primary production surface.
- README invents trigger behavior that does not match the workflow files.

## Acceptance Tests

1. `website-v2/README.md` mentions `.github/workflows/deploy-gcs.yml`.
2. `website-v2/README.md` mentions `.github/workflows/deploy-pages.yml`.
3. `website-v2/README.md` mentions both `main` and `workflow_dispatch`.
4. `website-v2/README.md` does not mention `deploy-websites.sh`.
5. The two workflow files still declare `workflow_dispatch`.

## Open Questions

1. Should the repo add a documented manual `gh workflow run` example for deploy recovery, or is naming the workflow files enough?
