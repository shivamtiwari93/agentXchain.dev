# Release Publish Workflow Observability Spec

---

## Purpose

Make the npm publish workflow tell the truth about what it is doing. A GitHub Actions step named `Publish tagged release` must not spend most of its runtime silently re-running strict preflight. Operators need to distinguish:

1. tagged-state verification
2. npm publication
3. downstream completeness work

without reverse-engineering the shell script while a release is in flight.

## Interface

### Workflow Contract

- `.github/workflows/publish-npm-on-tag.yml` must run strict tagged-state verification in a dedicated step before npm publication when the target version is not already published.
- The workflow publish step must call `bash scripts/publish-from-tag.sh --skip-preflight "${RELEASE_TAG}"`.

### Script Contract

- `cli/scripts/publish-from-tag.sh` continues to accept `bash scripts/publish-from-tag.sh <vX.Y.Z>` and, by default, still runs strict preflight itself.
- `cli/scripts/publish-from-tag.sh --skip-preflight <vX.Y.Z>` is allowed only as an explicit caller-owned contract. In that mode the script must skip the internal strict preflight and proceed with version checks, publish, and npm visibility verification.

## Behavior

1. Default local/operator usage remains fail-closed: malformed tags fail, version mismatches fail, strict preflight runs before npm publication, and registry visibility is verified after publish.
2. CI may split concerns: one workflow step re-verifies the tagged commit, a later step performs npm publication without duplicating that same strict preflight.
3. A rerun where npm already serves the target version may still skip npm publication and proceed directly to verification/postflight logic.

## Error Cases

- Unknown `publish-from-tag.sh` flags fail with usage output.
- Missing or repeated tag arguments fail before any npm mutation.
- `--skip-preflight` does not bypass package-version validation or registry-verification failures.

## Acceptance Tests

1. `publish-from-tag.sh` default mode still runs strict preflight before publish.
2. `publish-from-tag.sh --skip-preflight <tag>` skips the internal preflight and still publishes/verifies successfully.
3. Release workflow tests prove the GitHub workflow has a dedicated tagged-state reverify step and passes `--skip-preflight` to the publish script.

## Open Questions

- None. This is an observability and sequencing correction, not a release-policy change.
