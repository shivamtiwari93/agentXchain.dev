# Concurrent Observation Attribution Spec

## Purpose

Tighten acceptance-time artifact observation for concurrent authoritative turns so the first accepted sibling does not absorb undeclared file noise from another active sibling that has already staged its own result.

## Interface

- `attributeObservedChangesToTurn(observation, currentTurn, historyEntries, options)` accepts two additive inputs:
  - `options.currentDeclaredFiles`
  - `options.pendingConcurrentSiblingDeclarations`
- `acceptGovernedTurn()` collects pending sibling staged declarations from `.agentxchain/staging/<turn_id>/turn-result.json` for unaccepted concurrent siblings and passes them into attribution.
- Accepted history keeps using `observed_artifact.attributed_to_concurrent_siblings` for both accepted-sibling and pending-sibling attribution.

## Behavior

- Accepted sibling attribution remains marker-based and unchanged.
- For unaccepted concurrent siblings, attribution may use staged `files_changed` declarations when all of the following are true:
  - the sibling is listed in `currentTurn.concurrent_with`
  - the sibling is still active and not yet accepted
  - the sibling has a turn-scoped staged result whose `turn_id` matches the sibling turn
  - the file is declared by the sibling and not declared by the current turn
- Files attributed to pending concurrent siblings are removed from the current turn's observed `files_changed` set and recorded in `attributed_to_concurrent_siblings`.
- If no staged sibling declaration is available, the existing warning downgrade for unaccepted concurrent siblings remains as the fallback.

## Error Cases

- Missing sibling staging result: no pending attribution, fallback warning behavior stays in place.
- Malformed sibling staging result: ignore it; do not break current-turn acceptance.
- Declared overlap file where both turns list the same path: do not pre-attribute it away from the current turn.
- Non-concurrent staged turns must never influence attribution.

## Acceptance Tests

- `cli/test/repo-observer.test.js`
  - pending sibling staged declaration filters undeclared sibling-only files before comparison
- `cli/test/governed-state.test.js`
  - first accepted concurrent authoritative turn records its own observed files and preserves sibling-only files under `observed_artifact.attributed_to_concurrent_siblings`

## Open Questions

- Whether future authoritative runtimes should expose per-file content hashes inside staged results so pending-sibling attribution can become marker-based instead of declaration-based.
