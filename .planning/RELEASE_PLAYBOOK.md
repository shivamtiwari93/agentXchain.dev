# Release Playbook

> Current operator contract for cutting the next `agentxchain` release. This playbook supersedes fragmented release-day instructions spread across historical v1/v2 planning docs.

---

## Purpose

Define one current release-cut path for `agentxchain` that matches the shipped tooling and workflows:

1. local preflight proves the workspace is ready
2. version bump and tag create immutable release identity
3. GitHub Actions trusted publishing releases the tagged artifact
4. postflight proves the registry serves the exact executable artifact
5. Homebrew updates only after npm truth is live

This playbook exists because historical release notes and handoff specs in `.planning/` describe versions that never shipped. The repo needs one present-tense contract for the next cut, not another archaeology layer.

---

## Interface

### Preconditions

- Work from a clean git tree on the intended release commit.
- Have an updated `cli/CHANGELOG.md` entry for the target version.
- Use the canonical package and workflow:
  - package: `cli/package.json` (`name: agentxchain`)
  - workflow: `.github/workflows/publish-npm-on-tag.yml`
  - publish script: `cli/scripts/publish-from-tag.sh`
  - preflight script: `cli/scripts/release-preflight.sh`
  - postflight script: `cli/scripts/release-postflight.sh`
  - release identity script: `cli/scripts/release-bump.sh`

### Release Commands

```bash
cd cli
npm run preflight:release -- --target-version <semver>
npm run bump:release -- --target-version <semver>
npm run preflight:release:strict -- --target-version <semver>
git push origin main --follow-tags
```

> **Why `bump:release` instead of `npm version`?** Raw `npm version <semver>` from a subdirectory may update version files without creating the release commit and annotated tag. `release-bump.sh` separates the file update from git identity creation and verifies both before exiting. See `DEC-RIH-001`.

### Verification Commands

```bash
cd cli
npm run postflight:release -- --target-version <semver>
npm view "agentxchain@<semver>" version
```

### Downstream Update (Automated in CI)

The publish workflow now handles all downstream surfaces automatically:

1. **GitHub Release** — created by CI via `gh release create` (idempotent, skips if exists)
2. **Homebrew sync** — repo mirror always updated; canonical tap pushed if `HOMEBREW_TAP_TOKEN` is configured
3. **Completeness gate** — `release-downstream-truth.sh` runs as the final CI step

**If `HOMEBREW_TAP_TOKEN` is absent on a first publish attempt**, the workflow fails before npm publication. The operator must either:
- Configure `HOMEBREW_TAP_TOKEN` as a GitHub Actions secret and rerun the workflow, OR
- Run the sync locally: `npm run sync:homebrew -- --target-version <semver> --push-tap`

On reruns where npm already serves the target version, the workflow may proceed without the token and rely on `postflight:downstream` to prove the canonical tap and GitHub Release are already correct.

### Downstream Truth Verification (REQUIRED)

The release is **not complete** until downstream truth verification passes:

```bash
cd cli
npm run postflight:downstream -- --target-version <semver>
```

This checks: GitHub release exists, the canonical Homebrew tap formula SHA matches the registry tarball SHA, and the canonical Homebrew tap formula URL matches the registry tarball URL. A release with stale canonical tap truth is an incomplete release.

---

## Behavior

### 1. Preflight Before Version Bump

Run:

```bash
cd cli
npm run preflight:release -- --target-version <semver>
```

This is the soft gate. It checks git cleanliness, installs dependencies, runs tests, verifies the changelog heading, checks the package version, and does a pack dry-run. In default mode, dirty tree and pre-bump version mismatch are warnings. Everything else is fail-closed.

### 2. Create Release Identity

Run:

```bash
cd cli
npm run bump:release -- --target-version <semver>
```

This fail-closed script:
1. Asserts the tree is clean and the version is not already bumped
2. Updates `package.json` and `package-lock.json` via `npm version --no-git-tag-version`
3. Creates a commit with message `<semver>`
4. Creates an annotated tag `v<semver>`
5. Verifies both commit and tag exist before exiting

Do not use raw `npm version <semver>` — it may update files without creating git identity when run from a subdirectory. Do not hand-edit the tag or let CI invent the version.

### 3. Strict Preflight On Tagged State

Run:

```bash
cd cli
npm run preflight:release:strict -- --target-version <semver>
```

Strict mode turns dirty tree and version mismatch into hard failures. If strict preflight fails, stop. Do not push the tag and “see what happens in CI.”

### 4. Push The Release Tag

Run:

```bash
git push origin main --follow-tags
```

That push triggers `.github/workflows/publish-npm-on-tag.yml`. The workflow:

1. checks out the tagged commit, not branch head drift
2. re-runs strict preflight against the tag version
3. blocks first-time publish before npm mutation if canonical tap completion is impossible in CI
4. publishes via trusted publishing by default, falling back to token auth only when configured
5. skips republish on reruns if npm already serves the exact version
6. runs `release-postflight.sh` to verify the published artifact
7. syncs Homebrew formula (repo mirror + canonical tap if `HOMEBREW_TAP_TOKEN` is configured)
8. creates a GitHub Release via `gh release create` (idempotent — skips if already exists)
9. runs `release-downstream-truth.sh` as the **completeness gate** — workflow fails if any downstream surface is stale

**A green workflow means the release is complete across all distribution surfaces.** If `HOMEBREW_TAP_TOKEN` is absent on a first publish attempt, the workflow fails before npm publication with an explicit error annotation. On reruns, the workflow can still go green without the token, but only if `release-downstream-truth.sh` proves the canonical Homebrew tap and GitHub Release are already correct (`DEC-CI-COMPLETENESS-004`, `DEC-CI-COMPLETENESS-005`).

### 5. Postflight Truth

After the workflow succeeds, run:

```bash
cd cli
npm run postflight:release -- --target-version <semver>
```

Postflight is the release-truth gate. It must prove:

1. local tag exists
2. npm registry serves `agentxchain@<semver>`
3. `dist.tarball` metadata exists
4. checksum metadata exists
5. the published tarball installs into an isolated prefix and the installed binary reports the expected version

Tag existence alone is not release truth.

### 6. Sync Homebrew After npm Is Live

Only after postflight passes:

```bash
cd cli
npm run sync:homebrew -- --target-version <semver> --push-tap
```

This single command:
1. Fetches the tarball URL and SHA256 from npm registry
2. Updates the repo mirror formula and README
3. Pushes the canonical tap (`shivamtiwari93/homebrew-tap`)

In CI, this runs automatically after postflight if `HOMEBREW_TAP_TOKEN` is configured. Without the token, first-time publish is blocked before npm mutation. Reruns can still update the repo mirror without the token, but downstream truth must pass before the workflow can finish green.
The tag workflow creates a PR (`chore/homebrew-sync-v<version>`) for the repo-mirror update instead of pushing directly to `main`, since `main` has branch protection requiring PR reviews. The PR must be merged manually or via auto-merge as part of the release follow-through.
Workflow reruns update that same branch with `--force-with-lease` and reuse the open PR instead of failing on duplicate branch or PR creation.
If the GitHub token lacks `pull_requests` permission (common with the default `GITHUB_TOKEN` for GitHub Apps), the branch push succeeds but PR creation emits a warning annotation instead of failing the workflow. The PR must be created manually in that case.
If the repo mirror is already current but the canonical tap is stale, `--push-tap` still pushes the tap update. Repo-mirror equality is not allowed to short-circuit public-tap truth.

Do not update Homebrew against a version that is not yet live on npm.
Do not commit or push an all-zero placeholder SHA256. The tap and repo mirror must carry the real registry tarball checksum before release follow-through is considered complete.

---

## Error Cases

| Condition | Behavior |
|---|---|
| Working tree is dirty before release | Stop and clean or commit intentionally before `npm version`. |
| `CHANGELOG.md` lacks `## <semver>` | Stop and add the release notes before bumping. |
| `bump:release` fails | Stop. Do not create the tag manually as a workaround. Fix the issue and rerun `bump:release`. |
| `HOMEBREW_TAP_TOKEN` is missing before first publish | Workflow fails before npm publication. Configure `HOMEBREW_TAP_TOKEN`, or use a manual release path that completes the canonical tap before claiming release completion. |
| Canonical Homebrew tap is stale after CI or manual follow-through | Workflow fails the downstream completeness gate. Run `sync:homebrew --push-tap` locally or fix the tap, then rerun the workflow. |
| Strict preflight fails after version bump | Stop. Fix the issue and rerun strict preflight before pushing. |
| Publish workflow fails before npm serves the version | Fix the workflow or script failure; do not pretend the tag means release success. |
| Workflow rerun sees version already on npm | Treat as verification rerun; do not republish. |
| Postflight fails install smoke | Release is incomplete until the published tarball executes correctly. |
| Homebrew formula update is attempted before npm is live | Reject the update. Homebrew must trail verified npm truth. |

---

## Acceptance Tests

1. A single current release playbook exists at `.planning/RELEASE_PLAYBOOK.md`.
2. The playbook references the shipped workflow `.github/workflows/publish-npm-on-tag.yml`.
3. The playbook requires both default-mode and strict-mode preflight with explicit `--target-version`.
4. The playbook uses `bump:release` (not raw `npm version`) to create release identity.
5. The playbook requires postflight verification after publish succeeds.
6. The playbook states that Homebrew updates happen only after npm truth is live.
7. The playbook does not rely on deprecated v1/v2 release-specific planning files for current instructions.
8. The playbook lists `postflight:downstream` as a required step for release completion.
9. The playbook documents the manual Homebrew tap follow-through when CI cannot push.

---

## Open Questions

None. GitHub release creation is now an explicit required step with automated verification via `postflight:downstream`.
