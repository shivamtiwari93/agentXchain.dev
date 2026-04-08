# Proposal Lifecycle E2E Spec

**Status:** Active
**Author:** GPT 5.4
**Date:** 2026-04-07

## Purpose

`api_proxy` proposed authoring is not credible until the staged proposal can move through the real CLI lifecycle:

- a provider-backed `step` creates a proposal
- operators can inspect it with `proposal list|diff`
- operators can apply it to the workspace with `proposal apply`
- the next governed turn can still accept truthfully without blaming that applied work on the wrong actor

This slice also closes a repo-observer gap: proposal artifacts under `.agentxchain/proposed/` are operator evidence and must not poison clean-baseline checks for later code-writing turns when they are unchanged.

## Interface

### Proposal evidence baseline semantics

- `.agentxchain/proposed/` is baseline-exempt evidence for clean-baseline checks.
- Proposal artifacts remain actor-observable during acceptance if a turn actually mutates them after assignment.
- Unchanged proposal artifacts present before assignment must be filtered out of later observed diffs via the dirty-snapshot baseline.

### CLI lifecycle

1. `agentxchain step --role dev`
   - for `api_proxy` + `proposed`, stages proposal artifacts under `.agentxchain/proposed/<turn_id>/`
2. `agentxchain proposal list`
   - shows the staged proposal as `pending`
3. `agentxchain proposal diff <turn_id>`
   - shows the workspace-relative diff for the staged file set
4. `agentxchain proposal apply <turn_id>`
   - copies staged files into the workspace and records `APPLIED.json`
5. `agentxchain step --role qa`
   - a subsequent `review_only` turn must accept successfully when the proposal-applied workspace files were already present in its assignment baseline

## Behavior

- Proposal artifact directories alone must not make `checkCleanBaseline()` fail for later `proposed` or `authoritative` turns.
- Applying a proposal before assigning the next turn is valid operator behavior.
- The next turn's baseline must snapshot those applied workspace files so acceptance does not attribute them to the next actor.
- Review-only acceptance after proposal apply must stay green when the reviewer does not modify product files.

## Error Cases

- If proposal artifacts are treated as actor-owned dirt for clean-baseline checks, later code-writing assignment fails even though no actor touched the workspace.
- If proposal-applied files are not captured in the next turn baseline, a later `review_only` acceptance falsely fails for product file changes it did not make.

## Acceptance Tests

1. `checkCleanBaseline(root, 'proposed')` returns clean when the only dirty files live under `.agentxchain/proposed/`.
2. `captureBaseline()` records proposal artifacts in `dirty_snapshot` but still reports the baseline clean.
3. `observeChanges()` filters unchanged proposal artifacts that were already dirty at assignment time.
4. CLI E2E proves `step --role dev -> proposal list -> proposal diff -> proposal apply -> step --role qa` succeeds with a real mock `api_proxy` server.
5. The CLI E2E proves the provider prompt for the proposed-authoring turn explicitly instructs `proposed_changes`.
6. The CLI E2E proves the post-apply QA acceptance succeeds and does not falsely attribute the applied proposal file to QA.

## Open Questions

None. Proposal-aware completion gates are a separate slice.
