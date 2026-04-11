# Parallel Observed Attribution Spec

> Safe attribution of already-accepted sibling changes during parallel turn acceptance.

## Purpose

Parallel turns share one workspace baseline. When turn `B` is accepted after sibling turn `A`, raw repo observation includes files changed by both turns because both happened after `B` was assigned.

That creates a false positive:

- `B` can fail `artifact_observation` with undeclared file changes that actually belong to `A`
- or `B` can be forced into conflict even when it only touched disjoint files

AgentXchain needs a safe attribution rule so parallel acceptance does not blame a still-active turn for unchanged sibling files that were already accepted earlier.

## Interface

New observation behavior in `cli/src/lib/repo-observer.js`:

- observed artifacts include per-file markers for `files_changed`
- a new helper attributes unchanged files back to already-accepted concurrent siblings

Acceptance integration in `cli/src/lib/governed-state.js`:

- raw repo observation happens first
- sibling attribution runs before declared-vs-observed comparison
- conflict detection uses a stricter candidate set built from:
  - the attributed observation
  - plus any declared files that still appear in the raw baseline-to-now workspace union

## Behavior

1. Every observed artifact records `file_markers[path] = sha256:<digest>` for each observed file.
2. During parallel turn acceptance, inspect history entries accepted after the target turn's `assigned_sequence` and limited to `currentTurn.concurrent_with`.
3. For each raw observed file:
   - if a concurrent sibling previously accepted the same file
   - and the file's current marker exactly matches the sibling's recorded marker
   - then attribute that file to the sibling and remove it from the current turn's observed set
4. If the current marker differs from the sibling marker, keep the file attributed to the current turn. That means the current turn changed the file further and must either declare it or conflict on it.
5. The attributed observation becomes the source for:
   - `compareDeclaredVsObserved(...)`
   - `buildObservedArtifact(...)`
6. Conflict detection does **not** blindly fall back to the raw union. It uses:
   - all files still present in the attributed observation
   - plus any file that the current turn declared in `files_changed` and that still exists in the raw observation
7. This preserves two invariants at once:
   - sibling-only carry-over files do not trigger false conflicts
   - a turn that claims an overlapping file cannot evade conflict detection just because the current workspace marker matches the already-accepted sibling

## Error Cases

1. If a prior history entry has no `file_markers`, attribution falls back to the raw observation for that file.
2. If a file was changed by a sibling and then changed again by the current turn, the marker mismatch keeps it attributed to the current turn.
3. If there are no concurrent siblings or no later accepted siblings, attribution is a no-op.
4. If a declared overlapping file was attributed away because the sibling marker matches, it still remains conflict-eligible as long as that file appears in the raw observation.

## Acceptance Tests

1. A file unchanged since a concurrent sibling accepted it is filtered out of the current turn's observed set.
2. A file changed again after the sibling accepted it stays in the current turn's observed set.
3. Non-concurrent history entries do not affect attribution.
4. Parallel approval-policy E2E can now drain a mixed-runtime implementation phase without false `artifact_observation` failure.
5. Parallel conflict E2E still persists conflict state when a turn declares an overlapping file that is otherwise attributable to an accepted sibling.

## Open Questions

1. Should attributed sibling files be surfaced as warnings or report metadata for operator visibility?
2. Do we want to persist both raw observed files and attributed observed files in history for later audits?
