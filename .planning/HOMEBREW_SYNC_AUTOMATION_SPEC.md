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

### npm script: `cli/package.json`

```json
"sync:homebrew": "bash scripts/sync-homebrew.sh"
```

## Behavior

1. Fetch tarball URL from `npm view agentxchain@<version> dist.tarball`.
2. Download the tarball and compute SHA256.
3. Compare against current `cli/homebrew/agentxchain.rb`. If already in sync, exit 0 with "already in sync" message.
4. Update `cli/homebrew/agentxchain.rb`: replace `url` and `sha256` lines.
5. Update `cli/homebrew/README.md`: replace version and tarball URL lines.
6. If `--push-tap`:
   a. Clone `shivamtiwari93/homebrew-tap` to a temp directory.
   b. Replace `Formula/agentxchain.rb` with the updated formula.
   c. Commit with message `agentxchain <version>`.
   d. Push to `main`.
   e. Clean up temp directory.

## Error Cases

| Condition | Behavior |
|---|---|
| npm doesn't serve the target version | Exit 1 with clear error. Do not write partial updates. |
| Tarball download fails | Exit 1. |
| SHA256 computation fails | Exit 1. |
| Formula already matches | Exit 0 with "already in sync" message. |
| `--push-tap` without git access | Exit 1 with "push failed" error. |
| `--dry-run` | Print planned changes, exit 0 without writing. |

## Acceptance Tests

- AT-HS-001: Script updates repo mirror formula URL and SHA when they differ from npm registry.
- AT-HS-002: Script updates README version and tarball URL to match.
- AT-HS-003: Script is idempotent — running twice produces the same result.
- AT-HS-004: Script exits 1 when npm doesn't serve the target version.
- AT-HS-005: Script with `--dry-run` does not modify any files.
- AT-HS-006: CI workflow calls sync-homebrew after postflight when HOMEBREW_TAP_TOKEN is available.
- AT-HS-007: CI workflow does not fail if HOMEBREW_TAP_TOKEN is unavailable (graceful skip).
- AT-HS-008: The homebrew-mirror-contract test still passes after sync.

## Open Questions

None.
