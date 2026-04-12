# Homebrew Prep SHA Guard Spec

## Purpose

Close a release-path gap in `cli/scripts/release-bump.sh`:

- the script says the Homebrew formula SHA is "carried from the previous version"
- but pre-fix behavior only rewrote the tarball URL
- if an operator manually inserted a local `npm pack` SHA before bumping, that non-canonical SHA could be staged into the release commit

This spec makes the pre-publish Homebrew SHA behavior deterministic and fail-closed.

## Interface

Release identity creation continues to use:

```bash
cd cli
npm run bump:release -- --target-version <semver>
```

### Added invariant

When `release-bump.sh` auto-aligns `cli/homebrew/agentxchain.rb`, it must:

1. read the previously committed formula SHA from `HEAD:cli/homebrew/agentxchain.rb`
2. rewrite the working-tree formula SHA to that exact committed SHA
3. ignore any manually edited working-tree SHA value
4. continue to rewrite the formula URL and Homebrew README version/tarball to the target version

## Behavior

### Homebrew auto-alignment

During the Homebrew auto-alignment step, `release-bump.sh`:

1. resolves the target tarball URL for the target version
2. loads the previously committed Homebrew formula from `HEAD`
3. extracts the committed SHA256 from that formula
4. fails closed if the committed formula is missing or the SHA cannot be parsed
5. rewrites the working-tree formula URL to the target tarball URL
6. rewrites the working-tree formula SHA back to the committed SHA from `HEAD`
7. updates `cli/homebrew/README.md` version/tarball lines to the target version
8. prints that the carried SHA came from the previous committed formula and that local `npm pack` output is not canonical release truth

## Error Cases

- `cli/homebrew/agentxchain.rb` exists in the working tree but `HEAD:cli/homebrew/agentxchain.rb` does not exist
- the committed formula exists but does not contain a parseable 64-character SHA256
- the working-tree formula exists but does not contain a replaceable `sha256` line

All of these must fail the bump before tag creation.

## Acceptance Tests

- `AT-HPSG-001`: if the working-tree formula already contains the target-version URL plus an arbitrary SHA, `release-bump.sh` rewrites the SHA back to the previous committed SHA instead of preserving the manual value
- `AT-HPSG-002`: the release playbook explicitly says local `npm pack` SHA values are non-canonical and are not valid pre-publish Homebrew truth
- `AT-HPSG-003`: `release-bump.sh` fails closed when it cannot extract the prior committed SHA from `HEAD:cli/homebrew/agentxchain.rb`

## Open Questions

None. The invariant is narrow: pre-publish Homebrew SHA must come from the previous committed formula until `sync-homebrew.sh` replaces it with the live registry SHA.
