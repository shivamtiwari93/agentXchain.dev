# Homebrew Sync Automation Spec

> `DEC-HOMEBREW-SYNC-001` — automated Homebrew formula sync from live npm metadata

---

## Purpose

Eliminate the manual Homebrew tap update step that allows the canonical public tap (`shivamtiwari93/homebrew-tap`) to silently drift multiple versions behind the repo mirror and npm registry.

The problem: Steps 6.2 and 6.3 of the Release Playbook ("update the Homebrew tap" and "sync the repo mirror") are manual, error-prone, and have already caused multi-version drift (the tap was on 2.13.0 when the repo was on 2.15.0). The downstream truth script catches this drift _after the fact_, but only if someone runs it.

## Interface

### Script: `cli/scripts/sync-homebrew.sh`

```
Usage: bash scripts/sync-homebrew.sh --target-version <semver> [--push-tap] [--dry-run]
```

**Inputs:**
- `--target-version <semver>` (required): The version to sync to.
- `--push-tap`: If set, clone the canonical tap, update the formula, commit, and push. Requires git push access to `shivamtiwari93/homebrew-tap`.
- `--dry-run`: Print what would change without writing files or pushing.

**Outputs:**
- Updates `cli/homebrew/agentxchain.rb` with the correct URL and SHA256.
- Updates `cli/homebrew/README.md` with the correct version and tarball URL.
- If `--push-tap`: updates and pushes `shivamtiwari93/homebrew-tap/Formula/agentxchain.rb`.

**Exit codes:**
- 0: sync completed successfully (or already in sync)
- 1: npm registry doesn't serve the version, or push failed

### CI Integration: `.github/workflows/publish-npm-on-tag.yml`

Add a post-postflight step that runs `sync-homebrew.sh --push-tap` if the `HOMEBREW_TAP_TOKEN` secret is available. If the secret is not configured, emit a warning but do not fail the workflow — the sync can be run locally as a fallback.

**Branch protection constraint (`DEC-HOMEBREW-SYNC-008`):** The `main` branch has branch protection requiring PRs with 1 approving review. `github-actions[bot]` cannot push directly to `main`. The CI workflow must:
1. Create a feature branch (`chore/homebrew-sync-v<version>`) based on `origin/main`.
2. Commit the mirror update to that branch.
3. Request `pull-requests: write` permission and open a PR via `gh pr create` instead of pushing `HEAD:main`.
4. On workflow rerun, update the existing branch safely and reuse any existing open PR instead of failing on branch or PR collisions.
5. Fail closed if PR creation does not succeed. A pushed orphan branch is not accepted release follow-through.
6. PR approval/merge automation is allowed by repo settings, but the workflow must explicitly implement it before claiming full repo-mirror closure.
7. The workflow must snapshot the mutated mirror files and clear those local edits before switching from the tagged checkout to the PR branch. Branch creation cannot fail on its own dirty mirror-file changes.

**Auth requirements for canonical tap push:**
- Requires a PAT with `contents: write` on `shivamtiwari93/homebrew-tap`, stored as `HOMEBREW_TAP_TOKEN` secret.
- This is a one-time human setup task. The PAT should be a fine-grained token scoped to only `homebrew-tap` with `contents: write` permission.

### npm script: `cli/package.json`

```json
"sync:homebrew": "bash scripts/sync-homebrew.sh"
```

## Behavior

1. Fetch tarball URL from `npm view agentxchain@<version> dist.tarball`.
2. Download the tarball and compute SHA256.
3. Compare against current `cli/homebrew/agentxchain.rb`. If already in sync and `--push-tap` is not set, exit 0 with "already in sync" message.
4. If `--push-tap` is set, do not short-circuit on repo-mirror equality. The script must still verify and, if needed, push the canonical tap.
5. Update `cli/homebrew/agentxchain.rb`: replace `url` and `sha256` lines when the repo mirror differs.
6. Update `cli/homebrew/README.md`: replace version and tarball URL lines when the repo mirror differs.
7. If `--push-tap`:
   a. Clone `shivamtiwari93/homebrew-tap` to a temp directory.
   b. Compare the canonical tap formula against the target tarball URL and SHA.
   c. Replace `Formula/agentxchain.rb` only when the canonical tap differs.
   d. Configure a git identity if none exists so CI commits do not fail on an unconfigured runner.
   e. Commit with message `agentxchain <version>`.
   f. Push to `main`.
   g. Clean up temp directory.

## Error Cases

| Condition | Behavior |
|---|---|
| npm doesn't serve the target version | Exit 1 with clear error. Do not write partial updates. |
| Tarball download fails | Exit 1. |
| SHA256 computation fails | Exit 1. |
| Formula already matches and `--push-tap` is not set | Exit 0 with "already in sync" message. |
| Repo mirror matches but canonical tap is stale | Continue and push the canonical tap update. |
| `--push-tap` without git access | Exit 1 with "push failed" error. |
| `--dry-run` | Print planned changes, exit 0 without writing. |
| CI runner has no git user.name or user.email | Configure a bot identity locally before committing to the canonical tap. |
| PR creation fails after the branch push | Exit non-zero. Release follow-through is incomplete until the mirror PR exists. |

## Acceptance Tests

- AT-HS-001: Script updates repo mirror formula URL and SHA when they differ from npm registry.
- AT-HS-002: Script updates README version and tarball URL to match.
- AT-HS-003: Script is idempotent — running twice produces the same result.
- AT-HS-004: Script exits 1 when npm doesn't serve the target version.
- AT-HS-005: Script with `--dry-run` does not modify any files.
- AT-HS-006: CI workflow calls sync-homebrew after postflight when HOMEBREW_TAP_TOKEN is available.
- AT-HS-007: CI workflow does not fail if HOMEBREW_TAP_TOKEN is unavailable (graceful skip).
- AT-HS-008: The homebrew-mirror-contract test still passes after sync.
- AT-HS-009: `--push-tap` still verifies and updates the canonical tap when the repo mirror already matches npm.
- AT-HS-010: The sync path fails closed on commit/push errors instead of printing a false success.
- AT-HS-011: The mirror-update workflow is rerun-safe: it force-with-lease updates the existing branch and reuses an open PR instead of failing on duplicate branch/PR creation.
- AT-HS-012: The workflow requests `pull-requests: write` so it can create the mirror PR directly.
- AT-HS-013: If PR creation fails after the branch push, the workflow fails closed instead of leaving an orphan branch as warning-only debt.
- AT-HS-014: The workflow clears the snapshotted repo-mirror edits before switching branches, so reruns do not fail on "local changes would be overwritten by checkout".

## Known Debt

**`DEBT-HOMEBREW-PR-001`: Repo-mirror PR closeout is not yet automated end-to-end.**
The repository now allows GitHub Actions to create and approve pull requests, so the old "repo settings block Actions PR creation/approval" explanation is no longer true. The remaining gap is narrower: the workflow still opens the repo-mirror PR but does not yet submit an approval review, enable auto-merge, or merge it directly.

Resolution options:
1. Have the publish workflow approve and merge the generated PR once required checks pass
2. Enable auto-merge at the repo level and let the workflow opt the generated PR into auto-merge
3. Keep repo-mirror merge manual, but treat it as repo hygiene rather than release-completeness truth because canonical tap + GitHub release are already verified downstream

**Status:** Open. PR creation is automated; manual cherry-pick / manual PR creation are no longer accepted fallback patterns.

## Open Questions

None.

## Auth Setup (Human Task)

To enable fully automated Homebrew sync in CI, the repo owner must:

1. Create a fine-grained GitHub PAT scoped to `shivamtiwari93/homebrew-tap` with `contents: write` permission.
2. Add it as a repo secret named `HOMEBREW_TAP_TOKEN` on `shivamtiwari93/agentXchain.dev`.
3. The mirror-update PR no longer needs repo-setting changes to allow Actions PR creation/approval. Any remaining manual merge requirement is workflow behavior, not a GitHub settings blocker.
