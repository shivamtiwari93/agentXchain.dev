# Release Notes Ordering Automation Spec

## Purpose

Prevent the release-notes sidebar from regressing into mixed or duplicate ordering as new versions are cut.

The prior fix normalized `sidebar_position` values once, but the release process still allowed future releases to introduce duplicate positions. That is a process defect, not a one-off content bug.

## Interface

### Script

`cli/scripts/normalize-release-note-sidebar-positions.mjs`

```bash
node cli/scripts/normalize-release-note-sidebar-positions.mjs
```

### Release Integration

`cli/scripts/release-bump.sh` must run the normalizer before staging release surfaces.

## Behavior

1. Read every `website-v2/docs/releases/v*.mdx` file.
2. Parse the semantic version from the filename (`v2-99-0.mdx` -> `2.99.0`).
3. Sort release docs in strict reverse-semver order (newest first).
4. Rewrite each doc's frontmatter so:
   - newest release gets `sidebar_position: 0`
   - next gets `sidebar_position: 1`
   - and so on with unique contiguous values
5. If a release note already has the correct position, leave its content unchanged.
6. If a release note is missing `sidebar_position`, insert it into the frontmatter.
7. If a release note lacks frontmatter or has an unparseable filename, fail closed.
8. `release-bump.sh` stages any normalized release-note docs in the same release commit.

## Error Cases

- Release file missing frontmatter -> fail closed
- Release filename not matching `v<major>-<minor>-<patch>.mdx` -> fail closed
- Release directory missing or empty -> fail closed

## Acceptance Tests

1. All release-note docs have unique `sidebar_position` values.
2. Sorting release-note docs by `sidebar_position` yields the same order as sorting them by semantic version descending.
3. `release-bump.sh` copies the normalizer into the temp-repo fixture and runs it before staging.
4. `release-bump.sh` stages legacy release-note docs whose positions were shifted by the normalizer.
5. A new release with `sidebar_position: 0` and an older release with `sidebar_position: 0` is repaired automatically during the bump.

## Open Questions

None. The contract is narrow and deterministic.
