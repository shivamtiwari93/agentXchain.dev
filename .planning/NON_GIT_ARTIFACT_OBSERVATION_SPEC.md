# Non-Git Artifact Observation Spec

## Purpose

Prevent false artifact-mismatch failures when the orchestrator cannot inspect repo changes because the workspace is not a git repository.

The current failure mode is unacceptable:

- `observeChanges()` returns an empty `files_changed` array for non-git workspaces
- `compareDeclaredVsObserved()` interprets that as "observed no changes"
- `review_only` turns that declare legitimate review artifacts then fail as phantom changes

That is not evidence-backed governance. It is a transport error disguised as a policy violation.

## Interface

### `observeChanges(root, baseline)`

Must return an explicit availability signal:

- `observation_available: true` when diff-based observation is possible
- `observation_available: false` when the workspace is non-git or baseline observation is unavailable

The return shape remains backwards-compatible and still includes:

- `files_changed`
- `head_ref`
- `diff_summary`

### `compareDeclaredVsObserved(declared, observed, writeAuthority, options?)`

Accepts an optional fourth argument:

- `observation_available?: boolean`

## Behavior

### When observation is available

Keep the current strict behavior:

- `authoritative`: undeclared observed changes are errors; declared-but-unobserved files are warnings
- `review_only`: observed product-file changes are errors; declared-but-unobserved files are errors

### When observation is unavailable

Degrade gracefully instead of manufacturing phantom evidence:

- skip diff-based undeclared/phantom checks
- do not infer product-file violations from an unavailable diff
- return a warning that artifact observation was unavailable and diff-based checks were skipped

This is intentionally narrower than claiming success. It avoids a false negative without pretending independent observation occurred.

## Error Cases

- Non-git workspace must not be represented as "observed zero file changes"
- `review_only` turns in non-git workspaces must not fail solely because declared files cannot be independently observed
- Existing strict behavior must remain unchanged for normal git-backed governed runs

## Acceptance Tests

1. `observeChanges()` on a non-git workspace returns `observation_available: false`.
2. `compareDeclaredVsObserved()` returns no errors and a warning when `observation_available: false`.
3. Existing git-backed `review_only` phantom-file detection still errors.
4. Existing git-backed `authoritative` undeclared-change detection still errors.

## Open Questions

None for this slice. A later slice can decide whether observation-unavailable warnings should be surfaced in operator-facing acceptance output instead of being retained only in validation internals.
