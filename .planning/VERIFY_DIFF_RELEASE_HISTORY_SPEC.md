# Verify Diff Release History Truth Spec

**Status:** shipped

## Purpose

Keep archived release notes truthful after coordinator export diffing adopted the authority-first child repo-status boundary. Older pages may describe the release slice, but they must not teach operators that raw coordinator snapshot metadata is the repo-status truth source.

## Interface

- Archived release notes under `website-v2/docs/releases/`
- Docs guard test: `cli/test/verify-diff-release-notes-content.test.js`

## Behavior

1. Historical release pages may describe the release-time implementation.
2. If a release page mentions coordinator export repo-status drift or regressions, it must preserve the current boundary:
   - `summary.repo_run_statuses` remains raw coordinator snapshot metadata.
   - `diff --export` and `verify diff` derive repo-status changes/regressions from authority-first child repo status when nested child exports are readable.
3. Historical notes must not imply that stale `summary.repo_run_statuses` alone creates a coordinator repo-status change or regression.
4. When a page summarizes coordinator regressions, it should name the authority source directly instead of using vague phrases like “per-repo run-status changes” with no truth boundary.

## Error Cases

- An archived release page implies `summary.repo_run_statuses` is the primary coordinator repo-status authority.
- A page describes coordinator repo-status drift without naming the authority-first child repo-status boundary.
- A page implies stale coordinator snapshot metadata alone can trigger repo-status regressions.

## Acceptance Tests

- `AT-REL-VD-001`: `v2.98.0` states that coordinator export repo-status drift comes from authority-first child repo status when nested child exports are readable, while `summary.repo_run_statuses` remains preserved metadata.
- `AT-REL-VD-002`: `v2.100.0` states that child repo status regressions use authority-first child repo status when nested child exports are readable, and stale `summary.repo_run_statuses` alone does not create a regression.

## Open Questions

- None.
