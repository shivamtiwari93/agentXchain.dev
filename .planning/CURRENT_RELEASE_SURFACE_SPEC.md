# Current Release Surface Spec

> Guard the repo-controlled public surfaces that must track the current released package version.

## Purpose

Prevent version drift across the repo's front-door release surfaces. A release version is not just `cli/package.json`; operators and implementors also read the changelog, the release-notes route, the docs sidebar, the homepage badge, and the protocol implementor guide example. When those drift, the repo republishes contradictory release truth.

The guard also doubles as pre-bump release validation: when `AGENTXCHAIN_RELEASE_TARGET_VERSION` is set, it validates the repo-controlled release surfaces against that target version instead of the current `cli/package.json` version. This keeps `release-preflight.sh --target-version <semver>` compatible with version-synced public-surface tests.

## Interface

Add one automated guard test:

- `cli/test/current-release-surface.test.js`

The guard reads:

- `cli/package.json`
- `cli/CHANGELOG.md`
- `website-v2/docs/releases/`
- `website-v2/sidebars.ts`
- `website-v2/src/pages/index.tsx`
- `.agentxchain-conformance/capabilities.json`
- `website-v2/docs/protocol-implementor-guide.mdx`
- `.planning/LAUNCH_EVIDENCE_REPORT.md`
- `website-v2/static/llms.txt`
- `website-v2/static/sitemap.xml`

## Behavior

The guard must enforce these invariants against the current `cli/package.json` version by default, or `AGENTXCHAIN_RELEASE_TARGET_VERSION` when that env var is set:

1. The top changelog heading is `## <version>`.
2. A matching release-notes doc exists at `website-v2/docs/releases/v<major>-<minor>-<patch>.mdx`.
3. The docs sidebar includes that release-notes doc id.
4. The homepage hero badge shows `v<version>`.
5. `.agentxchain-conformance/capabilities.json` `version` matches `cli/package.json`.
6. The protocol implementor guide inline `capabilities.json` example includes the current version string.
7. `.planning/LAUNCH_EVIDENCE_REPORT.md` title carries the current release version.
8. `website-v2/static/llms.txt` lists the current release-notes route.
9. `website-v2/static/sitemap.xml` lists the current release-notes route.
10. The current release notes and top changelog section carry the same aggregate concrete test-count evidence line for the release.

## Error Cases

- If `package.json` is bumped but the release page is missing, the guard fails.
- If the changelog is updated but the homepage badge or sidebar is stale, the guard fails.
- If the implementor guide or capabilities example lags the package version, the guard fails.
- If the current release doc exists but `llms.txt` or `sitemap.xml` omit its public route, the guard fails.
- If pre-bump release surfaces are validated with `AGENTXCHAIN_RELEASE_TARGET_VERSION`, the guard fails when those surfaces do not match the target version even if `package.json` still points at the previous release.

## Acceptance Tests

- **AT-CRS-001**: The guard reads `cli/package.json` and asserts the top changelog heading matches.
- **AT-CRS-002**: The guard resolves the current release doc path from the package version and asserts the file exists.
- **AT-CRS-003**: The guard asserts `website-v2/sidebars.ts` links the current release doc id.
- **AT-CRS-004**: The guard asserts the homepage hero badge shows the current version.
- **AT-CRS-005**: The guard asserts `.agentxchain-conformance/capabilities.json` matches the package version.
- **AT-CRS-006**: The guard asserts the protocol implementor guide example shows the current version.
- **AT-CRS-007**: The guard asserts the current release page has an evidence line with a concrete test count and `0 failures`.
- **AT-CRS-008**: The guard extracts the aggregate evidence line (highest concrete `N tests ... 0 failures` count) from the top changelog section and current release page, then asserts they match exactly.
- **AT-CRS-009**: The guard asserts `.planning/LAUNCH_EVIDENCE_REPORT.md` title carries the current version.
- **AT-CRS-012**: The guard asserts `website-v2/static/llms.txt` lists the current release-notes route.
- **AT-CRS-013**: The guard asserts `website-v2/static/sitemap.xml` lists the current release-notes route.
