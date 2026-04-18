# Release Alignment Manifest Spec

## Purpose

Close the release-prep drift that keeps resurfacing as "surprise" failures during version cuts.

The current repo already has release-truth checks, but they are split across:

- `release-bump.sh` shell greps
- `current-release-surface.test.js`
- marketing-draft truth tests
- the human-facing release playbook

That split is the defect. Different surfaces can enforce different file lists, different evidence rules, and different stories about what counts as release-ready.

This spec defines one manifest-driven release-alignment contract so shell, tests, and docs stop disagreeing.

## Interface

### Shared module

Create `cli/src/lib/release-alignment.js`.

It exports:

- `RELEASE_ALIGNMENT_SCOPES`
- `RELEASE_ALIGNMENT_SURFACES`
- `getReleaseAlignmentContext(repoRoot, options)`
- `validateReleaseAlignment(repoRoot, options)`

### Validation script

Create `cli/scripts/check-release-alignment.mjs`.

Interface:

```bash
node cli/scripts/check-release-alignment.mjs [--target-version <semver>] [--scope prebump|current] [--json]
```

Defaults:

- `target-version`: current `cli/package.json` version
- `scope`: `current`

### Scopes

- `prebump`
  - validates the manual target-version surfaces that must already be prepared before `release-bump.sh` mutates package files
  - excludes Homebrew mirror URL/README alignment because `release-bump.sh` auto-aligns those in the next step
- `current`
  - validates the full current-release truth surface, including the Homebrew mirror

## Behavior

### Manifest structure

Each surface entry must declare:

- stable `id`
- human-readable `label`
- applicable `scopes`
- a validation function

### Shared context

`getReleaseAlignmentContext(...)` must derive shared release facts once:

- target version
- release doc ID (`vX-Y-Z`)
- release route (`/docs/releases/vX-Y-Z`)
- npm tarball URL
- top changelog section for the target version
- aggregate evidence line from that top changelog section
- aggregate evidence count for homepage proof-stat checks

No caller may recompute those facts differently.

### Required manual surfaces (`prebump`)

The shared validator must cover at least:

- `cli/CHANGELOG.md` top heading and evidence line
- `website-v2/docs/releases/v<major>-<minor>-<patch>.mdx` existence, governed heading, and evidence line
- `website-v2/sidebars.ts` release auto-generation contract
- `website-v2/src/pages/index.tsx` hero badge version and exact homepage proof stat count
- `.agentxchain-conformance/capabilities.json` version
- `website-v2/docs/protocol-implementor-guide.mdx` example version
- `.planning/LAUNCH_EVIDENCE_REPORT.md` title version and aggregate evidence line
- `.planning/SHOW_HN_DRAFT.md` current version and aggregate evidence line
- `.planning/MARKETING/TWITTER_THREAD.md` current version and aggregate evidence line
- `.planning/MARKETING/REDDIT_POSTS.md` current version and aggregate evidence line
- `.planning/MARKETING/HN_SUBMISSION.md` current version and aggregate evidence line
- `website-v2/static/llms.txt` current release route
- onboarding prereq blocks in:
  - `website-v2/docs/getting-started.mdx`
  - `website-v2/docs/quickstart.mdx`
  - `website-v2/docs/five-minute-tutorial.mdx`
  - each must carry the target-version `Minimum CLI version: agentxchain X.Y.Z or newer` line and the safe upgrade/fallback commands

### Auto-aligned surfaces (`current` only)

The shared validator must additionally cover:

- `cli/homebrew/agentxchain.rb` current npm tarball URL
- `cli/homebrew/README.md` current version and tarball URL

### `release-bump.sh`

`release-bump.sh` must use the shared validation script for its pre-bump guard instead of hardcoded shell greps.

### Release playbook truth

`RELEASE_PLAYBOOK.md` must stop claiming that a static `website-v2/static/sitemap.xml` is a manual release surface.

The playbook must describe:

- manual surfaces validated by the shared manifest
- Homebrew mirror alignment as an auto-aligned step in `release-bump.sh`
- Docusaurus sitemap generation as build-time output, not a manual pre-bump artifact

## Error Cases

- `release-bump.sh` and `current-release-surface.test.js` disagree on which surfaces are required
- homepage version is updated but homepage proof count still reflects the previous release
- launch evidence and marketing drafts still carry the previous release evidence line
- onboarding docs still pin the previous CLI version, so release-bump passes preflight only to fail at the inline test gate after the bump commit already exists
- playbook still tells operators to update a static sitemap file that no longer exists
- a new release-truth surface is added to tests but not to the release script, or vice versa

## Acceptance Tests

- `AT-RAM-001`: shared release-alignment module exports scoped surface definitions and validates the current repo cleanly in `current` scope
- `AT-RAM-002`: `check-release-alignment.mjs --scope prebump --target-version <semver>` fails with actionable surface-level errors when a prepared target-version fixture still has stale homepage or marketing truth
- `AT-RAM-003`: `release-bump.sh` uses `check-release-alignment.mjs --scope prebump` instead of duplicating shell-only version-surface checks
- `AT-RAM-004`: `RELEASE_PLAYBOOK.md` documents manifest-validated manual surfaces, treats Homebrew as auto-aligned, and does not claim a manual static sitemap artifact
- `AT-RAM-005`: `check-release-alignment.mjs --scope prebump --target-version <semver>` fails with actionable `onboarding_prereqs` errors when `getting-started.mdx`, `quickstart.mdx`, or `five-minute-tutorial.mdx` still pins the previous CLI version

## Open Questions

None. This slice is validation unification, not release-note generation.
