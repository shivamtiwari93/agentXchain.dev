# Release Cut Spec

> Contract for the release-day sequence that turns a release-ready governed CLI into a public npm artifact.

---

## Purpose

Define the exact commands and truth conditions that remain after autonomous product work is complete. This spec exists because release execution is part of the governed delivery surface: the commands, side effects, and handoff conditions must be explicit and testable, not implied by prose or by the existence of a git tag.

This spec is complementary to:

- `RELEASE_PREFLIGHT_SPEC.md` for local automatable checks
- `RELEASE_POSTFLIGHT_SPEC.md` for post-publish registry verification
- `V1_RELEASE_CHECKLIST.md` for release readiness criteria
- `RELEASE_BRIEF.md` for the short human handoff

---

## Interface/Schema

### Canonical Entry Point

```bash
cd cli
bash scripts/release-preflight.sh --target-version <version>
npm version <version>
bash scripts/release-preflight.sh --target-version <version> --strict
git push origin v<version>
bash scripts/release-postflight.sh --target-version <version>
```

### Release-Cut State

```ts
type ReleaseCutState = {
  preflight_hard_failures: 0 | number;
  working_tree_clean: boolean;
  package_version: string;
  release_commit_created: boolean;
  git_tag_created: boolean;
  release_tag_pushed: boolean;
  publish_workflow_succeeded: boolean;
  published_package: string | null;
  registry_truth_verified: boolean;
  homebrew_formula_updated: boolean;
};
```

### Required Outcomes

The release cut is complete only when all of these are true:

1. local preflight reports `0` hard failures
2. the git working tree is clean before the version bump
3. `cli/package.json` is `1.0.0`
4. a release commit exists in the repo history
5. git tag `v1.0.0` exists on that release commit
6. git tag `v1.0.0` has been pushed to GitHub
7. the publish workflow succeeds against that tag and npm registry serves `agentxchain@<version>`
8. `release-postflight.sh` passes against that published version
8. the Homebrew formula points at the published `1.0.0` tarball and SHA256

---

## Behavior

### 1. Preconditions

Before the operator starts the cut:

- all autonomous/spec/test work is already complete
- `bash scripts/release-preflight.sh` has `0` hard failures
- any non-release edits have been committed, shelved, or discarded

The default preflight script may still warn about a dirty tree or `package.json` being below the target version; those warnings must be cleared before the actual cut proceeds. After `npm version <version>`, the operator must run `bash scripts/release-preflight.sh --target-version <version> --strict` and require `0` warnings from the clean-tree/version checks before pushing the release tag.

### 2. Clean Tree Rule

The canonical cut starts from a clean git working tree. This is not optional because the version bump step is expected to create the release commit and tag atomically.

### 3. Version Bump, Commit, and Tag

The canonical version bump command is:

`npm version <version>`

In the current workspace, `npm config get git-tag-version` is `true`. Therefore `npm version 1.0.0` is not merely a file edit:

- it updates `cli/package.json`
- it creates the release commit
- it creates git tag `v<version>`

The governed release brief and checklist must treat this as the commit/tag step unless the operator deliberately passes `--no-git-tag-version`.

### 4. Publish Step

After the version bump succeeds, the operator runs the strict post-bump preflight:

`bash scripts/release-preflight.sh --target-version <version> --strict`

This must pass with no dirty-tree or package-version failures. Only then does the operator push the release tag:

`git push origin v<version>`

That push triggers `.github/workflows/publish-npm-on-tag.yml`, which checks out the tag ref, runs `scripts/publish-from-tag.sh`, enforces version/tag match, reruns strict preflight, publishes via temporary `.npmrc`, and polls the registry until the requested version is visible.

Registry verification is still part of the release cut, and it is no longer optional narrative hand-waving. After the workflow reports success, the operator or agent must run:

`bash scripts/release-postflight.sh --target-version <version>`

Manual fallback remains available only if the workflow fails after the release identity already exists:

```bash
cd cli
NPM_TOKEN=<token> bash scripts/publish-from-tag.sh v<version>
```

### 5. Homebrew Update

After the workflow publishes successfully **and postflight passes**, the operator updates the Homebrew tap formula with the published tarball URL and SHA256, then verifies the formula resolves correctly. This step depends on the real published tarball, so it cannot be completed earlier.

### 6. Non-Canonical Helper Script

`cli/scripts/publish-npm.sh` is a valid helper for npm auth/ownership checks and publishing, but it is **not** the canonical governed `1.0.0` cut path by itself because it runs:

```bash
npm version "$BUMP" --no-git-tag-version
```

That bypasses the default commit/tag side effects required by the canonical release sequence. It may still be used intentionally, but only if the operator separately manages the release commit and tag.

---

## Error Cases

| Condition | Behavior |
|---|---|
| `release-preflight.sh` has any hard failure | Stop. Do not version bump or push the release tag. |
| Working tree is dirty before `npm version <version>` | Stop and clean/shelve unrelated changes first. |
| `npm version <version>` fails | Stop. Do not push the release tag. Investigate git cleanliness, npm config, or package metadata. |
| `npm version <version>` succeeds but tag `v<version>` is missing | Treat as an environment/config anomaly and fix before pushing. |
| `release-preflight.sh --strict` fails after the version bump | Stop. Do not push the release tag until the tree is clean and `package.json` remains at the target version. |
| Tag push fails or workflow does not start | Do not mark the release as complete. Resolve git remote or Actions trigger issues first. |
| Publish workflow fails | Do not mark the release as complete. Resolve auth/ownership/preflight/registry errors first. |
| Publish workflow succeeds but `release-postflight.sh` fails | Do not mark the release as complete. The tag and CI status are insufficient; fix registry/install truth first. |
| Homebrew formula still points at the previous tarball | npm release is public, but Homebrew distribution is not yet updated. Keep the release task open until formula update and verification finish. |

---

## Acceptance Tests

1. The canonical release instructions use `cd cli && npm version <version>` as the version-bump, commit, and tag step.
2. The release docs do not instruct the operator to create a second manual commit and tag after a successful default `npm version 1.0.0`.
3. `HUMAN_TASKS.md` lists the remaining release-day actions explicitly instead of claiming all human work is resolved.
4. `RELEASE_BRIEF.md` distinguishes resolved human setup/decision tasks from pending release execution tasks.
5. The release cut spec includes a mandatory post-publish verification step through `release-postflight.sh`.
6. The spec explicitly records why `publish-npm.sh` is non-canonical for the governed release cut.
7. The canonical release sequence includes a strict post-bump preflight before the tag push that triggers publish automation.

---

## Open Questions

1. Should the project add a dedicated `scripts/release-cut.sh` wrapper after `2.0.1`, or is the explicit manual sequence preferable for auditability?
2. Should Homebrew formula verification become a hard release-gate item in a future release-postflight helper once the tap workflow is stable?
