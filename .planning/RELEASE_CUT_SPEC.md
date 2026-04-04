# Release Cut Spec — v1

> **SUPERSEDED.** This spec was the v1.0.0 release-day contract. v1.0.0 was never published to npm (project shipped 0.8.x then jumped to 2.1.1). The general release-cut pattern (clean workspace → preflight → version bump → strict preflight → tag push → workflow → homebrew) remains valid and is now the implicit contract in `HUMAN_TASKS.md` and the `publish-npm-on-tag.yml` workflow. Preserved for historical decision context (`DEC-RELEASE-*` series).

> ~~Contract for the human-operated release-day sequence that turns the release-ready governed CLI into the public `1.0.0` artifact.~~

---

## Purpose

Define the exact human-run steps that remain after autonomous product work is complete. This spec exists because release execution is part of the governed delivery surface: the commands, side effects, and handoff conditions must be explicit and testable, not implied by a prose brief.

This spec is complementary to:

- `RELEASE_PREFLIGHT_SPEC.md` for local automatable checks
- `V1_RELEASE_CHECKLIST.md` for release readiness criteria
- `RELEASE_BRIEF.md` for the short human handoff

---

## Interface/Schema

### Canonical Entry Point

```bash
cd cli
bash scripts/release-preflight.sh
npm version 1.0.0
bash scripts/release-preflight.sh --strict
git push origin v1.0.0
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
7. the publish workflow succeeds against that tag and npm registry serves `agentxchain@1.0.0`
8. the Homebrew formula points at the published `1.0.0` tarball and SHA256

---

## Behavior

### 1. Preconditions

Before the operator starts the cut:

- all autonomous/spec/test work is already complete
- `bash scripts/release-preflight.sh` has `0` hard failures
- any non-release edits have been committed, shelved, or discarded

The default preflight script may still warn about a dirty tree or `package.json` being below `1.0.0`; those warnings must be cleared before the actual cut proceeds. After `npm version 1.0.0`, the operator must run `bash scripts/release-preflight.sh --strict` and require `0` warnings from the clean-tree/version checks before pushing the release tag.

### 2. Clean Tree Rule

The canonical cut starts from a clean git working tree. This is not optional for the governed `1.0.0` path because the version bump step is expected to create the release commit and tag atomically.

### 3. Version Bump, Commit, and Tag

The canonical version bump command is:

```bash
cd cli
npm version 1.0.0
```

In the current workspace, `npm config get git-tag-version` is `true`. Therefore `npm version 1.0.0` is not merely a file edit:

- it updates `cli/package.json`
- it creates the release commit
- it creates git tag `v1.0.0`

The governed release brief and checklist must treat this as the commit/tag step unless the operator deliberately passes `--no-git-tag-version`.

### 4. Publish Step

After the version bump succeeds, the operator runs the strict post-bump preflight:

```bash
bash scripts/release-preflight.sh --strict
```

This must pass with no dirty-tree or package-version failures. Only then does the operator push the release tag:

```bash
git push origin v1.0.0
```

That push triggers `.github/workflows/publish-npm-on-tag.yml`, which checks out the tag ref, runs `scripts/publish-from-tag.sh`, enforces version/tag match, reruns strict preflight, publishes via temporary `.npmrc`, and polls the registry until the requested version is visible.

Registry verification is still part of the release cut, for example:

```bash
npm view agentxchain@1.0.0 version
```

Manual fallback remains available only if the workflow fails after the release identity already exists:

```bash
cd cli
NPM_TOKEN=<token> bash scripts/publish-from-tag.sh v1.0.0
```

### 5. Homebrew Update

After the workflow publishes successfully, the operator updates the Homebrew tap formula with the published tarball URL and SHA256, then verifies the formula resolves correctly. This step depends on the real published tarball, so it cannot be completed earlier.

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
| Working tree is dirty before `npm version 1.0.0` | Stop and clean/shelve unrelated changes first. |
| `npm version 1.0.0` fails | Stop. Do not push the release tag. Investigate git cleanliness, npm config, or package metadata. |
| `npm version 1.0.0` succeeds but tag `v1.0.0` is missing | Treat as an environment/config anomaly and fix before pushing. |
| `release-preflight.sh --strict` fails after the version bump | Stop. Do not push the release tag until the tree is clean and `package.json` remains at `1.0.0`. |
| Tag push fails or workflow does not start | Do not mark the release as complete. Resolve git remote or Actions trigger issues first. |
| Publish workflow fails | Do not mark the release as complete. Resolve auth/ownership/preflight/registry errors first. |
| Homebrew formula still points at the previous tarball | npm release is public, but Homebrew distribution is not yet updated. Keep the release task open until formula update and verification finish. |

---

## Acceptance Tests

1. The canonical release instructions use `cd cli && npm version 1.0.0` as the version-bump, commit, and tag step.
2. The release docs do not instruct the operator to create a second manual commit and tag after a successful default `npm version 1.0.0`.
3. `HUMAN_TASKS.md` lists the remaining release-day actions explicitly instead of claiming all human work is resolved.
4. `RELEASE_BRIEF.md` distinguishes resolved human setup/decision tasks from pending release execution tasks.
5. `V1_RELEASE_CHECKLIST.md` lists the clean-tree, version/tag, tag-push workflow, and Homebrew update steps as outstanding release-day actions.
6. The spec explicitly records why `publish-npm.sh` is non-canonical for the governed release cut.
7. The canonical release sequence includes a strict post-bump preflight before the tag push that triggers publish automation.

---

## Open Questions

1. Should the project add a dedicated `scripts/release-cut.sh` wrapper after `1.0.0`, or is the explicit manual sequence preferable for auditability?
2. Should Homebrew formula verification become a hard release-gate item inside `release-preflight.sh` once the tap workflow is stable?
