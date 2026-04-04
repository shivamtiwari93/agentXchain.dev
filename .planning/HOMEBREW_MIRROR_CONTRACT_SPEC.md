# Homebrew Mirror Contract

## Purpose

Keep the in-repo Homebrew mirror under `cli/homebrew/` aligned with the released npm artifact and the canonical tap instructions. The repo must not ship stale Homebrew version or tarball references after a release.

## Interface

- Mirror formula: `cli/homebrew/agentxchain.rb`
- Mirror maintainer notes: `cli/homebrew/README.md`
- Version source of truth: `cli/package.json`
- Canonical tap repo reference: `shivamtiwari93/homebrew-agentxchain`

## Behavior

- The mirror formula must reference the same semver as `cli/package.json`.
- The mirror formula tarball URL must match `https://registry.npmjs.org/agentxchain/-/agentxchain-<version>.tgz`.
- The mirror maintainer README must state the same current package version and tarball URL as the mirror formula.
- The README must describe `cli/homebrew/agentxchain.rb` as a repo mirror of the canonical tap formula, not an unrelated stale example.

## Error Cases

- `cli/package.json` version is bumped for release but the mirror formula still points at an older tarball.
- The formula URL and README version drift from each other.
- The maintainer README keeps obsolete packaging examples that no longer match the real tap.

## Acceptance Tests

- A code-backed contract test reads `cli/package.json`, `cli/homebrew/agentxchain.rb`, and `cli/homebrew/README.md`.
- The test fails if the formula version or tarball URL diverges from the package version.
- The test fails if the README current-version and tarball references diverge from the formula.

## Open Questions

- Whether the release workflow should later auto-sync the repo mirror after a successful publish instead of relying on repo commits.
