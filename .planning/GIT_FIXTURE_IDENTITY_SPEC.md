# Git Fixture Identity Spec

## Purpose

Make git-backed test fixtures and CI proof scripts deterministic on clean runners that do not have a global git identity configured.

The current failure is release-blocking:

- temp repos are created in tests and proof scripts
- helpers run `git commit`
- Ubuntu CI runners do not guarantee `user.name` / `user.email`
- release preflight passes locally but fails in CI publish

That is a broken proof pipeline, not an acceptable environment quirk.

## Interface

### `cli/test-support/git-test-helpers.js`

`gitInit(root)` must:

- initialize the repo
- set local `user.name`
- set local `user.email`
- create the initial scaffold commit

`gitCommitAll(root)` must continue to commit safely after test turns.

### `examples/ci-runner-proof/git-helpers.mjs`

Must provide the same local git identity behavior for CI proof workspaces.

## Behavior

- Helpers must never depend on ambient global git config.
- Identity must be configured locally in the temp repo so commits work the same on developer machines and CI runners.
- The chosen identity is test-only and non-routable.

## Error Cases

- Fresh CI runner with no global git config must still allow helper-created commits.
- Existing git-backed behavior must remain unchanged apart from deterministic identity setup.

## Acceptance Tests

1. Helper-created temp repos have local `user.name` and `user.email` configured.
2. The previously failing lifecycle test in `gate-evaluator.test.js` passes.
3. The CI runner proof scripts can create their scaffold commits on a clean runner.

## Open Questions

None for this slice.
