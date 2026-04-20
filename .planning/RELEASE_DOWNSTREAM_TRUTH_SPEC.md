# Release Downstream Truth Spec

**Status:** Shipped
**Decision:** `DEC-RELEASE-DOWNSTREAM-001` through `DEC-RELEASE-DOWNSTREAM-004`

## Purpose

The CI publish workflow verifies npm registry truth (version, tarball, checksum, install smoke). But two downstream release surfaces are updated manually after CI and have no automated verification:

1. **GitHub release** — created via `gh release create` after publish succeeds
2. **Canonical Homebrew tap** — formula URL and SHA256 updated in `shivamtiwari93/homebrew-tap` after postflight passes

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

### Check 1: GitHub Release Is Fully Published
- Uses `gh release view v<version>` to verify the GitHub release exists
- Extracts tag name and confirms it matches `v<version>`
- Confirms the release is **not** a draft
- Confirms `publishedAt` is present
- Confirms the release URL is the canonical tagged page: `https://github.com/shivamtiwari93/agentXchain.dev/releases/tag/v<version>`
- Retries (configurable, default 3 attempts / 5s delay) for propagation
- This catches malformed release objects that technically exist but still surface as draft or `untagged-*` URLs

### Check 2: Homebrew Tap SHA Matches Registry Tarball SHA
- Fetches the registry tarball: `curl -sL <tarball_url> | shasum -a 256`
- Fetches the canonical Homebrew formula from the `shivamtiwari93/homebrew-tap` git repo (default) or from an override URL for tests/special cases
- Extracts the SHA256 from the formula
- Asserts they match
- This catches the "local-pack SHA vs registry tarball SHA" class of bug

### Check 3: Homebrew Tap URL Matches Registry Tarball URL
- Reads `dist.tarball` from npm registry
- Reads `url` from the canonical Homebrew formula
- Asserts they match

### Canonical Source Rule
- Default verification source is the tap git repo (`https://github.com/shivamtiwari93/homebrew-tap.git`), not `raw.githubusercontent.com`
- Reason: GitHub raw/CDN caching can briefly serve stale branch content even after the tap repo `main` branch has moved
- `AGENTXCHAIN_DOWNSTREAM_FORMULA_URL` remains available as an override for tests and emergency diagnostics

## Error Cases

| Condition | Behavior |
|-----------|----------|
| `gh` CLI not available | FAIL with diagnostic |
| GitHub release does not exist after retries | FAIL |
| GitHub release exists but is still draft / missing `publishedAt` / points at an `untagged-*` URL | FAIL |
| Canonical Homebrew formula cannot be fetched from the tap repo or override source | FAIL |
| Canonical Homebrew formula SHA does not match registry SHA | FAIL |
| Canonical Homebrew formula URL does not match registry URL | FAIL |
| npm registry does not serve the version | FAIL (defers to existing postflight) |

## Acceptance Tests

1. `AT-RDT-001`: Running `postflight:downstream -- --target-version 2.14.0` against the current repo state passes all 3 checks.
2. `AT-RDT-002`: A canonical Homebrew formula fetch failure fails checks 2 and 3.
3. `AT-RDT-003`: A canonical Homebrew formula with wrong SHA256 fails check 2.
4. `AT-RDT-004`: A canonical Homebrew formula with wrong tarball URL fails check 3.
5. `AT-RDT-005`: A missing GitHub release fails check 1.
6. `AT-RDT-006`: Default repo-based formula fetching succeeds without relying on a raw GitHub URL.
7. `AT-RDT-007`: A GitHub release that still exists only as a draft fails check 1.
8. `AT-RDT-008`: A GitHub release with an `untagged-*` URL fails check 1 even if the tag name matches.

## Open Questions

None. Scope is deliberately narrow: verify existing downstream surfaces, not create new ones.
