# Release Identity Hardening Spec

## Purpose

Close two release-path defects exposed during the v2.19.0 cut:

1. **`npm version <semver>` from `cli/` updates version files but may not create the release commit and annotated tag.** When `package.json` lives in a subdirectory, `npm version` may behave differently depending on git root detection, `.npmrc` settings, or existing dirty state. The release playbook assumes commit+tag are created atomically. When they aren't, the operator must manually recover — as happened in Turn 92.

2. **Homebrew tap automation degrades to a warning when `HOMEBREW_TAP_TOKEN` is absent.** The CI workflow warns but continues, leaving the canonical tap stale. The operator contract says "Homebrew updates only after npm truth is live" — but it does not say "canonical tap truth is required for release completion." This ambiguity allowed v2.19.0 to require manual tap push.

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
5. Creates a single commit: `<semver>` (matching npm convention)
6. Creates an annotated tag: `v<semver>` with message `v<semver>`
7. Verifies commit and tag exist before exiting
8. Exit code 0 only if all steps succeed; any failure is fatal

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
4. Assert clean git tree (fail if dirty — don't create a release commit on top of uncommitted work)
5. Run `npm version ${TARGET} --no-git-tag-version` — this updates `package.json` only
6. Stage `package.json` and `package-lock.json`
7. `git commit -m "${TARGET}"`
8. `git tag -a "v${TARGET}" -m "v${TARGET}"`
9. Verify: `git rev-parse "v${TARGET}"` succeeds
10. Verify: `git log -1 --format=%s` equals `${TARGET}`
11. Print success with commit SHA and tag

### Error Cases

- Invalid semver → exit 1 with message
- Already at target version → exit 1 with message
- Dirty tree → exit 1 with message
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
- `AT-RIH-006`: `release-bump.sh` fails before mutating version files when the tree is dirty or the target tag already exists

## Open Questions

None. The scope is narrow and the defects are concrete.
