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

### Release Commands

```bash
cd cli
npm run preflight:release -- --target-version <semver>
npm version <semver>
npm run preflight:release:strict -- --target-version <semver>
git push origin main --follow-tags
```

### Verification Commands

```bash
cd cli
npm run postflight:release -- --target-version <semver>
npm view "agentxchain@<semver>" version
```

### Downstream Update

After postflight passes and npm serves the requested version:

1. Create the GitHub release: `gh release create v<semver> --title "v<semver>" --notes "..."`
2. Update the Homebrew tap `shivamtiwari93/homebrew-tap` to the new tarball URL and SHA256
3. Sync the repo Homebrew mirror (`cli/homebrew/agentxchain.rb`)

### Downstream Truth Verification

After all downstream surfaces are updated, verify consistency:

```bash
cd cli
npm run postflight:downstream -- --target-version <semver>
```

This checks: GitHub release exists, Homebrew formula SHA matches registry tarball SHA, and Homebrew formula URL matches registry tarball URL.

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
npm version <semver>
```

This updates `cli/package.json`, creates the release commit, and creates tag `v<semver>`. Do not hand-edit the tag or let CI invent the version.

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
3. publishes via trusted publishing by default, falling back to token auth only when configured
4. skips republish on reruns if npm already serves the exact version
5. runs `release-postflight.sh` before declaring success

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

### 6. Update Homebrew After npm Is Live

Only after postflight passes:

1. fetch the tarball URL and SHA256 from npm
2. update the Homebrew formula in `shivamtiwari93/homebrew-tap`
3. push the tap update
4. optionally create or verify the GitHub release notes surface after npm and Homebrew truth agree

Do not update Homebrew against a version that is not yet live on npm.

---

## Error Cases

| Condition | Behavior |
|---|---|
| Working tree is dirty before release | Stop and clean or commit intentionally before `npm version`. |
| `CHANGELOG.md` lacks `## <semver>` | Stop and add the release notes before bumping. |
| `npm version <semver>` fails | Stop. Do not create the tag manually as a workaround. |
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
4. The playbook uses `npm version <semver>` to create release identity.
5. The playbook requires postflight verification after publish succeeds.
6. The playbook states that Homebrew updates happen only after npm truth is live.
7. The playbook does not rely on deprecated v1/v2 release-specific planning files for current instructions.

---

## Open Questions

None. GitHub release creation is now an explicit required step with automated verification via `postflight:downstream`.
