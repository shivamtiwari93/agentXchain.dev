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

- Work from a clean git tree, then prepare the target-version release-surface files before bumping:
  - `cli/CHANGELOG.md`
  - `website-v2/docs/releases/v<major>-<minor>-<patch>.mdx`
  - `website-v2/sidebars.ts`
  - `website-v2/src/pages/index.tsx`
  - `.agentxchain-conformance/capabilities.json`
  - `website-v2/docs/protocol-implementor-guide.mdx`
  - `.planning/LAUNCH_EVIDENCE_REPORT.md`
  - `.planning/SHOW_HN_DRAFT.md`
  - `.planning/MARKETING/TWITTER_THREAD.md`
  - `.planning/MARKETING/REDDIT_POSTS.md`
  - `.planning/MARKETING/HN_SUBMISSION.md`
  - `website-v2/static/llms.txt`
- Have an updated `cli/CHANGELOG.md` entry for the target version.
- **Manifest-driven release alignment:** `cli/scripts/check-release-alignment.mjs --scope prebump --target-version <semver>` is the pre-bump authority for the manual release surfaces above. It validates target-version truth across changelog, release notes, homepage badge and proof stat, capabilities, protocol implementor guide, launch evidence, marketing drafts, and `llms.txt`.
- **Homebrew mirror alignment:** `release-bump.sh` auto-aligns `cli/homebrew/agentxchain.rb` and `cli/homebrew/README.md` after the pre-bump manifest check. Do not manually substitute a local `npm pack` SHA into the formula during prep; `release-bump.sh` overwrites the formula SHA with the previous committed value because only the live registry tarball SHA is canonical. See `DEC-RELEASE-PREFLIGHT-004`.
- **Sitemap truth:** `website-v2/static/sitemap.xml` is no longer a manual release artifact. Docusaurus generates sitemap output at build time, so release prep must validate the release doc and discovery routes, not hand-edit a stale static sitemap file.
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
# Option A (recommended): bump with inline preflight gate.
# bump:release auto-aligns Homebrew mirror, runs inline preflight (tests, pack,
# docs build) BEFORE creating the tag. If preflight fails, the commit exists but
# no tag is created — safe to amend and re-run. See DEC-RELEASE-PROCESS-005.
npm run bump:release -- --target-version <semver> \
  --coauthored-by "Your Name <email>"
git push origin main --follow-tags

# Option B: bump with skip-preflight (recovery / already-verified scenarios).
# Only use when preflight has already been verified separately.
npm run bump:release -- --target-version <semver> --skip-preflight \
  --coauthored-by "Your Name <email>"
npm run preflight:release:strict -- --target-version <semver>
git push origin main --follow-tags
```

> **Why `bump:release` instead of `npm version`?** Raw `npm version <semver>` from a subdirectory may update version files without creating the release commit and annotated tag. `release-bump.sh` separates the file update from git identity creation, requires an explicit `--coauthored-by` trailer value, and verifies both commit subject and trailer before exiting. See `DEC-RIH-001`.

### Verification Commands

```bash
cd cli
npm run postflight:release -- --target-version <semver>
npm view "agentxchain@<semver>" version
```

### Downstream Update (Automated in CI)

The publish workflow now handles all downstream surfaces automatically:

1. **GitHub Release** — created by CI from the governed website release page, and reruns repair the release body via `gh release edit` if an older low-signal body already exists
2. **Homebrew sync** — canonical tap pushed with `HOMEBREW_TAP_TOKEN`; repo mirror updated in CI by direct push when `REPO_PUSH_TOKEN` (preferred) or a broad `HOMEBREW_TAP_TOKEN` is available, otherwise via PR fallback
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

### 1. Preflight Before Version Bump (Optional)

Run:

```bash
cd cli
npm run preflight:release -- --target-version <semver>
```

This is the soft gate. It checks git cleanliness, installs dependencies, runs tests, verifies the changelog heading, checks the package version, and does a pack dry-run. In default mode, dirty tree and pre-bump version mismatch are warnings. Everything else is fail-closed.

**Important:** Default preflight runs the release-surface tests with `AGENTXCHAIN_RELEASE_TARGET_VERSION`, which validate the same target release route and current-release truth used by the shared manifest. The recommended path is still `bump:release` first, then strict preflight, so Homebrew mirror alignment is handled automatically before the full current-scope checks run.

### 2. Create Release Identity

Run:

```bash
cd cli
npm run bump:release -- --target-version <semver> \
  --coauthored-by "Your Name <email>"
```

This fail-closed script:
1. Asserts the tree contains no dirty paths outside the target-version release-surface whitelist and the version is not already bumped
2. Verifies all manual governed release surfaces reference the target version through `check-release-alignment.mjs --scope prebump`
3. **Normalizes release-note ordering** — rewrites every `website-v2/docs/releases/v*.mdx` `sidebar_position` so the autogenerated docs sidebar stays strict newest-first with unique contiguous positions
4. **Auto-aligns the Homebrew mirror** — updates the formula URL and README version/tarball to the target version; carries the previous committed formula SHA and overwrites any hand-edited working-tree SHA (corrected post-publish by `sync-homebrew.sh`)
5. Updates `package.json` and `package-lock.json` via `npm version --no-git-tag-version`
6. Stages all version files and allowed release surfaces, including any older release-note docs touched by the ordering normalizer
7. Creates a commit with subject `<semver>` plus body trailer `Co-Authored-By: <value from --coauthored-by>`
8. Creates an annotated tag `v<semver>`
9. Verifies commit subject, required trailer, and tag all exist before exiting

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
2. blocks first-time publish before npm mutation if canonical tap completion is impossible in CI
3. re-runs strict preflight against the tag version in a dedicated `Re-verify tagged release before publish` step
4. publishes via trusted publishing by default, falling back to token auth only when configured
5. keeps the publish script fail-closed for direct operator use, but passes `--skip-preflight` in CI because the tagged-state verification already ran in the prior workflow step
6. skips republish on reruns if npm already serves the exact version
7. runs `release-postflight.sh` to verify the published artifact
8. syncs Homebrew formula (repo mirror + canonical tap if `HOMEBREW_TAP_TOKEN` is configured)
9. creates a GitHub Release via `gh release create` using the governed release page as the body source; reruns use `gh release edit` so the operator-facing release object stays truthful instead of keeping stale autogenerated notes
10. runs `release-downstream-truth.sh` as the **completeness gate** — workflow fails if any downstream surface is stale

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
5. `npx --yes -p agentxchain@<semver> -c "agentxchain --version"` resolves from the public registry in an isolated temp environment
6. the published tarball installs into an isolated prefix and the installed binary reports the expected version
7. the published runner and adapter exports import from a clean consumer project

Tag existence alone is not release truth.

### 6. Sync Homebrew After npm Is Live

#### Three-Phase Homebrew Lifecycle

The Homebrew mirror goes through three states during every release. Understanding this lifecycle prevents the recurring confusion about "main is red after release."

| Phase | State | `npm test` | Action |
|-------|-------|-----------|--------|
| **Phase 1: Pre-publish** | `release-bump.sh` updates formula URL to new version; SHA is carried from the previous committed formula (real but wrong version). Local `npm pack` SHA values are not valid here. | Green with `AGENTXCHAIN_RELEASE_PREFLIGHT=1` (Tier 2 tests skipped). | Push tag → CI publishes to npm. |
| **Phase 2: Post-publish, pre-sync** | npm is live; repo mirror SHA is stale (previous version's hash). | Green — Tier 1 (internal consistency) passes; Tier 2 (version alignment) passes on URL but SHA is from the wrong version. | Run `verify:post-publish` or `sync:homebrew`. |
| **Phase 3: Post-sync** | Repo mirror SHA matches the published tarball. | Fully green, no env skip needed. | CI merges the repo-mirror PR or a local operator sync commits the update. Main is now truthfully green. |

**The release is not operationally complete until main reaches Phase 3.** If CI cannot merge the repo-mirror PR, the workflow must fail closed instead of reporting release completion.

#### Operator Commands

**Option A: Full verification (recommended)**

```bash
cd cli
npm run verify:post-publish -- --target-version <semver>
```

This single command: verifies npm serves the version, runs `sync-homebrew.sh` to update the repo mirror, then runs the full test suite without the preflight skip. If it passes, the mirror is correct and main is green.

**Option B: Manual sync + tap push**

```bash
cd cli
npm run sync:homebrew -- --target-version <semver> --push-tap
```

This command:
1. Fetches the tarball URL and SHA256 from npm registry
2. Updates the repo mirror formula and README
3. Pushes the canonical tap (`shivamtiwari93/homebrew-tap`)

#### CI Behavior

In CI, the publish workflow runs sync automatically after postflight if `HOMEBREW_TAP_TOKEN` is configured. Without the token, first-time publish is blocked before npm mutation. Reruns can still update the repo mirror without the token, but downstream truth must pass before the workflow can finish green.
The tag workflow requests `pull-requests: write`, creates or reuses a PR (`chore/homebrew-sync-v<version>`) for the repo-mirror update, submits the approval review, enables squash auto-merge with branch deletion, and waits for the PR to reach `MERGED`.
Workflow reruns update that same branch with `--force-with-lease` and reuse the open PR instead of failing on duplicate branch or PR creation.
If auto-merge cannot be enabled or times out (typically due to branch protection requiring a review that `github-actions[bot]` cannot self-approve), the workflow **auto-closes the PR** with an explanatory comment and deletes the branch (`DEC-HOMEBREW-MIRROR-AUTOCLOSE-001`). The canonical tap is always correct at this point. Agents sync the repo mirror on their next push. To eliminate the PR fallback entirely, configure `REPO_PUSH_TOKEN` (admin PAT with `contents:write`).
If the repo mirror is already current but the canonical tap is stale, `--push-tap` still pushes the tap update. Repo-mirror equality is not allowed to short-circuit public-tap truth.

#### Invariants

- Do not update Homebrew against a version that is not yet live on npm.
- Do not commit or push an all-zero placeholder SHA256. The tap and repo mirror must carry the real registry tarball checksum before release follow-through is considered complete.
- **Main is not green until the repo mirror reaches Phase 3.** The `AGENTXCHAIN_RELEASE_PREFLIGHT=1` env skip is for the pre-publish window only, not a permanent workaround.

---

## Error Cases

| Condition | Behavior |
|---|---|
| Working tree contains changes outside the allowed release-surface whitelist before release | Stop and clean or commit the unrelated work before `bump:release`. |
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
10. The playbook documents the three-phase Homebrew lifecycle (pre-publish, post-publish pre-sync, post-sync) with explicit state transitions.
11. The playbook provides `verify:post-publish` as the executable contract for Phase 2 → Phase 3 transition.
12. The playbook states that main is not green until the repo mirror reaches Phase 3.

---

## Open Questions

None. GitHub release creation is now an explicit required step with automated verification via `postflight:downstream`.
