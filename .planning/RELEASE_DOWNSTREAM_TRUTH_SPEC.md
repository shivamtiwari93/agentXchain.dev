# Release Downstream Truth Spec

**Status:** Active
**Decision:** `DEC-RELEASE-DOWNSTREAM-001` through `DEC-RELEASE-DOWNSTREAM-004`

## Purpose

The CI publish workflow verifies npm registry truth (version, tarball, checksum, install smoke). But two downstream release surfaces are updated manually after CI and have no automated verification:

1. **GitHub release** — created via `gh release create` after publish succeeds
2. **Homebrew tap** — formula URL and SHA256 updated in `shivamtiwari93/homebrew-tap` after postflight passes

These surfaces drift when agents or operators forget to update them, or update them with wrong values (e.g., local-pack SHA instead of registry tarball SHA — a real bug that occurred during v2.10.0).

## Interface

```bash
# Run after all downstream surfaces are updated
npm run postflight:downstream -- --target-version <semver>

# Underlying script
bash scripts/release-downstream-truth.sh --target-version <semver>
```

## Behavior

The script checks 3 downstream truth conditions:

### Check 1: GitHub Release Exists
- Uses `gh release view v<version>` to verify the GitHub release exists
- Extracts tag name and confirms it matches `v<version>`
- Retries (configurable, default 3 attempts / 5s delay) for propagation

### Check 2: Homebrew Tap SHA Matches Registry Tarball SHA
- Fetches the registry tarball: `curl -sL <tarball_url> | shasum -a 256`
- Reads the Homebrew tap formula from the local repo mirror at `cli/homebrew/agentxchain.rb`
- Extracts the SHA256 from the formula
- Asserts they match
- This catches the "local-pack SHA vs registry tarball SHA" class of bug

### Check 3: Homebrew Tap URL Matches Registry Tarball URL
- Reads `dist.tarball` from npm registry
- Reads `url` from the Homebrew formula
- Asserts they match

## Error Cases

| Condition | Behavior |
|-----------|----------|
| `gh` CLI not available | FAIL with diagnostic |
| GitHub release does not exist after retries | FAIL |
| Homebrew formula SHA does not match registry SHA | FAIL |
| Homebrew formula URL does not match registry URL | FAIL |
| npm registry does not serve the version | FAIL (defers to existing postflight) |

## Acceptance Tests

1. `AT-RDT-001`: Running `postflight:downstream -- --target-version 2.13.0` against the current repo state passes all 3 checks.
2. `AT-RDT-002`: A Homebrew formula with wrong SHA256 fails check 2.
3. `AT-RDT-003`: A missing GitHub release fails check 1.

## Open Questions

None. Scope is deliberately narrow: verify existing downstream surfaces, not create new ones.
