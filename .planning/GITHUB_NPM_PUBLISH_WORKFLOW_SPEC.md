# GitHub NPM Publish Workflow Spec

> Contract for the GitHub Actions path that publishes `agentxchain` to npm from a release tag without inventing a second release process.

---

## Purpose

Define the automation boundary for npm publication. The governed release cut still begins with an intentional human version bump and git tag. GitHub Actions may automate the registry publication only after that immutable release identity exists.

This spec exists to prevent a sloppy split-brain release story where local docs say "cut a tag locally" while CI independently bumps versions, publishes arbitrary branch state, or skips the release preflight contract.

---

## Interface

### Workflow Triggers

```yaml
on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:
    inputs:
      tag:
        description: Existing release tag in vX.Y.Z format
        required: true
        type: string
```

### Script Entry Point

```bash
cd cli
bash scripts/publish-from-tag.sh v1.0.0
```

### Required Environment

```text
NPM_TOKEN                         # optional; when absent, publish uses trusted publishing (OIDC)
NPM_VIEW_RETRY_ATTEMPTS           # optional, default 12
NPM_VIEW_RETRY_DELAY_SECONDS      # optional, default 5
RELEASE_POSTFLIGHT_RETRY_ATTEMPTS # optional, default 12
RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS # optional, default 10
```

---

## Behavior

### 1. Human-Owned Release Identity

The canonical release identity is still created by a human from a clean workspace via `npm version <semver>`. That step updates `cli/package.json`, creates the release commit, and creates git tag `v<semver>`.

The GitHub workflow must not bump versions, mutate tracked files, or create the tag itself.

### 2. Tag-Scoped Checkout

The publish job must operate on the tagged commit, not the default branch head. For tag-push events, this is `github.ref`. For manual reruns, the operator supplies an existing tag input and checkout must resolve that tag directly.

### 3. Publish Guardrails

`cli/scripts/publish-from-tag.sh` is the guarded entry point. It must:

1. reject missing or malformed tags
2. derive the semver from `v<semver>`
3. require `cli/package.json.version === <semver>`
4. run `bash scripts/release-preflight.sh --strict --target-version <semver>`
5. publish via temporary `.npmrc` when `NPM_TOKEN` is present, otherwise use trusted publishing
6. poll `npm view <package>@<semver> version` until the registry serves the version or the retry budget is exhausted

If the registry already serves the exact `<package>@<semver>` when the script starts, the workflow must treat the run as a verification rerun: skip `npm publish`, keep the strict preflight, and continue into postflight.

### 4. Registry Verification

Registry verification is part of the publish contract, not a best-effort extra. Publish success is not complete until `npm view agentxchain@<semver> version` returns the requested version.

The verification loop exists because registry visibility can lag publication by several seconds.

After `publish-from-tag.sh` succeeds, the workflow must run `scripts/release-postflight.sh --target-version <semver>` so the same workflow also verifies:

- `dist.tarball`
- checksum metadata
- install smoke by installing the exact published tarball into an isolated temporary prefix and executing the installed binary by explicit path

The workflow may set a higher retry budget than the script default when running on GitHub-hosted runners, because registry install smoke can lag behind metadata visibility even after publish succeeds.

### 5. Failure Semantics

If strict preflight fails, the workflow must fail without publishing.

If `package.json` and the release tag disagree, the workflow must fail. Publishing `v1.0.0` from a commit whose package version is `0.9.0` is not a recoverable warning; it is a broken release.

If registry verification never converges within the retry budget, the workflow must fail. A half-finished publish with no verification signal is not trustworthy automation.

If postflight fails after publish, the workflow must still fail. A package that uploaded but does not expose tarball/checksum metadata or cannot execute from the registry is not a complete release.

---

## Error Cases

| Condition | Behavior |
|---|---|
| Tag argument missing | Fail with usage text. |
| Tag is not `v<semver>` | Fail before any npm command runs. |
| `package.json.version` does not match tag semver | Fail before publish. |
| `NPM_TOKEN` missing | Use trusted publishing instead of token auth. |
| Strict preflight fails | Fail before publish. |
| `npm publish` fails | Fail the workflow. |
| `npm view` does not return the new version before retry budget is exhausted | Fail the workflow. |
| publish succeeds but postflight fails | Fail the workflow. |

---

## Acceptance Tests

1. A standalone spec exists for the GitHub/npm publish path instead of burying the rules inside workflow YAML.
2. `cli/scripts/publish-from-tag.sh` rejects malformed tags and version mismatches.
3. `cli/scripts/publish-from-tag.sh` supports token auth and trusted publishing.
4. `cli/scripts/publish-from-tag.sh` runs strict release preflight before publish.
5. `cli/scripts/publish-from-tag.sh` verifies registry visibility after publish with bounded retries.
6. `.github/workflows/publish-npm-on-tag.yml` triggers on semver tag pushes and supports manual reruns against an existing tag.
7. `.github/workflows/publish-npm-on-tag.yml` checks out the tag ref, not branch head state.
8. `.github/workflows/publish-npm-on-tag.yml` runs `release-postflight.sh` after publish succeeds.

---

## Open Questions

1. Should the publish workflow also create a GitHub Release object after npm verification, or stay registry-only for v1?
2. Should Homebrew formula update remain human-operated after npm publish, or should that become a second workflow once the tap update path is scripted?
