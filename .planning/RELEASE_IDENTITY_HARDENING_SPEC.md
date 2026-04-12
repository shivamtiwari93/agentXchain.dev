# Release Identity Hardening Spec

## Purpose

Close two release-path defects exposed during the v2.19.0 cut:

1. **`npm version <semver>` from `cli/` updates version files but may not create the release commit and annotated tag.** When `package.json` lives in a subdirectory, `npm version` may behave differently depending on git root detection, `.npmrc` settings, or existing dirty state. The release playbook assumes commit+tag are created atomically. When they aren't, the operator must manually recover — as happened in Turn 92.

2. **Homebrew tap automation degrades to a warning when `HOMEBREW_TAP_TOKEN` is absent.** The CI workflow warns but continues, leaving the canonical tap stale. The operator contract says "Homebrew updates only after npm truth is live" — but it does not say "canonical tap truth is required for release completion." This ambiguity allowed v2.19.0 to require manual tap push.

3. **The release-identity commit can exclude the already-validated target-version public surfaces.** `current-release-surface.test.js` validates changelog, release notes, homepage badge, capabilities, implementor-guide example, launch evidence title, and release discoverability through `llms.txt` and `sitemap.xml` against `AGENTXCHAIN_RELEASE_TARGET_VERSION`. If `release-bump.sh` stages only a subset of those surfaces, operators are forced into temporary prep commits or a final release commit that does not actually contain the validated public truth.

## Interface

### New Script: `cli/scripts/release-bump.sh`

Replaces raw `npm version <semver>` in the release playbook with a fail-closed wrapper.

```bash
bash scripts/release-bump.sh --target-version <semver>
```

**Contract:**
1. Validates semver format
2. Validates `cli/package.json` is not already at target version
3. Runs `npm version <semver> --no-git-tag-version` to update files only
4. Also updates `package-lock.json` version field if present
5. Allows dirty pre-bump changes only in the target-version release-surface whitelist:
   - `cli/CHANGELOG.md`
   - `website-v2/docs/releases/v<major>-<minor>-<patch>.mdx`
   - `website-v2/sidebars.ts`
   - `website-v2/src/pages/index.tsx`
   - `.agentxchain-conformance/capabilities.json`
   - `website-v2/docs/protocol-implementor-guide.mdx`
   - `.planning/LAUNCH_EVIDENCE_REPORT.md`
   - `website-v2/static/llms.txt`
   - `website-v2/static/sitemap.xml`
   - `cli/homebrew/agentxchain.rb`
   - `cli/homebrew/README.md`
6. Auto-aligns the Homebrew mirror formula URL and README version/tarball to the target version. The SHA256 is carried from the previous committed formula because the registry tarball SHA is inherently a post-publish artifact (npm registry tarballs are not byte-identical to local `npm pack` output). Any working-tree SHA edits are overwritten during the bump. `sync-homebrew.sh` corrects the SHA after publish. See `DEC-HOMEBREW-SHA-SPLIT-001`.
7. Stages those allowed release-surface files together with `package.json` and `package-lock.json`
7. Creates a single commit: `<semver>` (matching npm convention)
8. Creates an annotated tag: `v<semver>` with message `v<semver>`
9. Verifies commit and tag exist before exiting
10. Exit code 0 only if all steps succeed; any failure is fatal

### Updated Playbook

The release playbook replaces `npm version <semver>` with `npm run bump:release -- --target-version <semver>`.

### Updated Downstream Contract

The release playbook adds an explicit "Canonical Tap Truth" section:
- Release is **not considered complete** until `postflight:downstream` passes
- If CI cannot push the canonical tap (missing `HOMEBREW_TAP_TOKEN`), the operator MUST run `npm run sync:homebrew -- --target-version <semver> --push-tap` manually before signing off
- The downstream truth check is listed as a required step, not an optional follow-through

## Behavior

### `release-bump.sh`

1. Parse `--target-version <semver>` (required)
2. `cd` to cli directory (script is in `cli/scripts/`)
3. Assert `package.json` version ≠ target (prevent double-bump)
4. Assert the tree contains no dirty paths outside the release-surface whitelist for the target version
5. Run `npm version ${TARGET} --no-git-tag-version` — this updates `package.json` only
6. Fail closed unless every governed version surface already references the target version (9 manual surfaces: changelog, release notes page, sidebar, homepage badge, capabilities, implementor guide, launch evidence, `llms.txt`, `sitemap.xml`)
7. Auto-align the Homebrew mirror formula URL and README to the target version (SHA carried from the previous committed formula; corrected post-publish by `sync-homebrew.sh`)
8. Stage `package.json`, `package-lock.json`, and any allowed release-surface files that exist
9. `git commit -m "${TARGET}"`
10. `git tag -a "v${TARGET}" -m "v${TARGET}"`
11. Verify: `git rev-parse "v${TARGET}"` succeeds
12. Verify: `git log -1 --format=%s` equals `${TARGET}`
13. Print success with commit SHA and tag

### Error Cases

- Invalid semver → exit 1 with message
- Already at target version → exit 1 with message
- Dirty tree outside the release-surface whitelist → exit 1 with message naming the offending files
- `npm version --no-git-tag-version` fails → exit 1
- `git commit` fails → exit 1
- `git tag` fails → exit 1
- Post-creation verification fails → exit 1 (should never happen, but fail-closed)

## Acceptance Tests

- `AT-RIH-001`: `release-bump.sh` script exists and is executable
- `AT-RIH-002`: Playbook references `bump:release` instead of raw `npm version`
- `AT-RIH-003`: Playbook lists `postflight:downstream` as a required step, not optional
- `AT-RIH-004`: Playbook documents the manual Homebrew tap follow-through when CI cannot push
- `AT-RIH-005`: In a temp git repo rooted above `cli/`, `release-bump.sh --target-version <semver>` updates `package.json` and `package-lock.json`, creates commit `<semver>`, and creates an annotated tag `v<semver>` that dereferences to `HEAD`
- `AT-RIH-006`: `release-bump.sh` fails before mutating version files when the tree contains dirty paths outside the release-surface whitelist or the target tag already exists
- `AT-RIH-007`: In a temp git repo with target-version release-surface edits staged only in the whitelist, `release-bump.sh --target-version <semver>` includes those release-surface files in the release commit instead of rejecting the tree or omitting them
- `AT-RIH-008`: `release-bump.sh` rejects the bump when version surfaces still reference the old version (all-stale and partial-drift cases), does not mutate `package.json`, and does not create a tag
- `AT-RIH-009`: The repo-mirrored Homebrew formula and `cli/homebrew/README.md` are auto-aligned by `release-bump.sh`: the URL and version are updated to the target version automatically, the SHA256 is carried from the previous committed formula even if the working tree already contains a different SHA, and both files are staged into the release commit
- `AT-RIH-010`: In a temp git repo with target-version discovery-surface edits prepared, `release-bump.sh --target-version <semver>` stages `website-v2/static/llms.txt` and `website-v2/static/sitemap.xml` into the same release commit, and rejects the bump if either omits the current release route

## Open Questions

None. The scope is narrow and the defects are concrete.
