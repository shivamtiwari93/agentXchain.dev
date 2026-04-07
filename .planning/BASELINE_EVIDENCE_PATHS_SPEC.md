# Baseline-Exempt Evidence Paths — Spec

## Purpose

Prevent orchestrator and review evidence artifacts from falsely blocking later code-writing turns, without weakening artifact observation or review accountability.

## Problem

Two repo-native evidence surfaces can remain dirty after an accepted turn even when no product files are dirty:

- `.agentxchain/reviews/` for review artifacts
- `.agentxchain/reports/` for auto-generated governance reports

Today `checkCleanBaseline()` treats those paths as actor-owned dirty files. That means a later `authoritative` or `proposed` assignment can fail even though the only uncommitted changes are evidence artifacts.

Claude's suggested shortcut, adding `.agentxchain/reviews/` to `OPERATIONAL_PATH_PREFIXES`, is wrong. It would stop blaming the next actor, but it would also stop observing manual review artifacts during acceptance. That would weaken the review-only contract.

## Interface

### `checkCleanBaseline(root, writeAuthority)`

- Must ignore dirty files under:
  - `.agentxchain/reviews/`
  - `.agentxchain/reports/`
- Must continue to block on dirty product files and dirty `.planning/*` files.

### `captureBaseline(root)`

- `clean` means "clean enough for the next code-writing turn", not "literally zero dirty files in git status".
- Pre-existing dirty review/report evidence must still be captured in `dirty_snapshot` so later acceptance can filter them out if unchanged.

### `observeChanges(root, baseline)`

- Must filter unchanged baseline-dirty files in all branches:
  - same-HEAD working tree changes
  - committed changes since baseline
  - working-tree fallback
- Otherwise a pre-existing dirty review/report artifact leaks back into the next turn's observed diff when HEAD changes.

## Behavior

1. Dirty `.agentxchain/reviews/*` and `.agentxchain/reports/*` files do not block `authoritative` or `proposed` assignment.
2. Those files are still observable during the turn that created or changed them.
3. If they were already dirty at assignment time and remain unchanged, they must not appear in the next turn's acceptance diff.
4. Dirty `.planning/*` and product files remain blocking. This fix is not a blanket "docs don't count" relaxation.

## Error Cases

- If a later actor modifies a pre-existing review/report artifact after assignment, it must reappear in observed changes because the file marker changed.
- If a review-only actor writes product files, the existing artifact-validation failure behavior remains unchanged.
- If the workspace is non-git, the existing degraded observation contract remains unchanged.

## Acceptance Tests

1. `checkCleanBaseline(root, 'authoritative')` returns `{ clean: true }` when the only dirty file is `.agentxchain/reviews/<file>.md`.
2. `checkCleanBaseline(root, 'authoritative')` returns `{ clean: true }` when the only dirty file is `.agentxchain/reports/report-<run>.md`.
3. `captureBaseline(root)` may report `clean: true` while still storing baseline-dirty review/report files in `dirty_snapshot`.
4. `observeChanges(root, baseline)` excludes an unchanged review artifact that was already dirty at baseline, even when the actor made a new commit after assignment.
5. A real `api_proxy` review acceptance followed by `assignGovernedTurn(..., 'dev')` succeeds without requiring a commit of the derived review artifact first.

## Open Questions

- None for this slice. `.planning/*` remains intentionally blocking because planning artifacts are workflow inputs, not passive evidence.

## Decision

- `DEC-BASELINE-EVIDENCE-001`: `.agentxchain/reviews/` and `.agentxchain/reports/` are baseline-exempt evidence paths, not operational paths.
- `DEC-BASELINE-EVIDENCE-002`: Baseline-dirty filtering applies across both same-HEAD and head-changed observation so pre-existing evidence dirt does not poison the next accepted diff.
