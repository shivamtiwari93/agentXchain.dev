# GCS Deploy Auth Contract

> Keep the repo-owned GitHub Actions deploy path for `agentxchain.dev` truthful and recoverable.

---

## Purpose

The repo already ships a working GitHub Actions deployment path for `agentxchain.dev` through `.github/workflows/deploy-gcs.yml`. This spec defines the auth contract that keeps that path deterministic:

- GitHub Actions must have at least one valid GCP auth path
- the workflow must not invoke `google-github-actions/auth` with empty inputs
- operators must be able to understand the fallback order without reverse-engineering the workflow
- the workflow must continue deploying `website-v2/build/` rather than any retired `website/` surface

---

## Interface

### GitHub Secrets

Supported auth inputs, in priority order:

1. `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT` (Workload Identity Federation)
2. `GCP_SERVICE_ACCOUNT_KEY`

### Workflow Surface

`.github/workflows/deploy-gcs.yml` must support:

- Workload Identity Federation (WIF) auth when both WIF secrets are present
- service-account JSON auth when `GCP_SERVICE_ACCOUNT_KEY` is present
- explicit failure with a clear message when neither auth path is configured

No other workflow steps change their external behavior.

---

## Behavior

1. The workflow checks for WIF secrets first.
2. If WIF is fully configured, it authenticates with `workload_identity_provider` + `service_account`.
3. If WIF is absent and `GCP_SERVICE_ACCOUNT_KEY` exists, it authenticates with `credentials_json`.
4. If neither auth path exists, the workflow fails before any deploy commands run.
5. The workflow builds `website-v2/` and deploys `website-v2/build/` to GCS.
6. Build, sync, cache-metadata enforcement, and verification steps remain unchanged.

---

## Error Cases

1. Only one WIF secret present: treat as unconfigured WIF and fall through to JSON auth or fail clearly.
2. Invalid `GCP_SERVICE_ACCOUNT_KEY`: auth step fails and deployment stops before any `gsutil` mutation.
3. No auth secrets configured: workflow exits with a deterministic configuration error instead of the opaque upstream action error.

---

## Acceptance Tests

1. A workflow run with `GCP_SERVICE_ACCOUNT_KEY` configured authenticates and reaches the deploy steps.
2. A workflow run with no GCP auth secrets fails with an explicit configuration message.
3. Existing WIF-based deployments remain compatible if those secrets are later added.
4. The spec does not claim the deploy path is currently broken when the workflow already supports both auth modes.
5. The spec points at `website-v2/build/`, not a retired `website/` output.

---

## Open Questions

1. Should the repo eventually drop service-account JSON fallback once WIF is proven stable enough, or keep both paths permanently for recovery?
2. Should the deploy service account be narrowed from project-level storage admin to bucket-level permissions?
