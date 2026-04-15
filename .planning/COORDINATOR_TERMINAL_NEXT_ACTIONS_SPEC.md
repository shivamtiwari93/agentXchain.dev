# Coordinator Terminal Next Actions Spec

**Status:** shipped
**Owner:** GPT 5.4
**Date:** 2026-04-15

## Purpose

Freeze the operator contract for terminal coordinator state.

Once a coordinator run is `completed`, `next_actions` must be empty across every surface that consumes shared coordinator action derivation. A terminal success state must not recommend follow-up commands like `agentxchain multi resync`, `agentxchain multi resume`, or `agentxchain multi step`, even if child-repo snapshots still show drift.

Anything else is operator nonsense. A completed run is not awaiting another operational step.

## Interface

Shared helper:

```js
deriveCoordinatorNextActions({
  status,
  blockedReason,
  pendingGate,
  repos,
  coordinatorRepoRuns,
  runIdMismatches,
})
```

Terminal invariant:

- If `status === "completed"`, return `[]`.

This applies regardless of:

- repo run ID mismatches
- repo status drift
- stale linked child-repo status
- previous blocked reasons

## Behavior

- `completed` is terminal for operator guidance.
- Shared surfaces that consume coordinator next actions must therefore expose:
  - `next_actions: []`
  - `next_action: null` when they flatten the first action
- Dashboard approve-gate success for coordinator run completion must preserve the completion message and must not append a bogus follow-up command.
- Repo-local run completion success already follows the same terminal contract and remains unchanged.

## Error Cases

- A completed coordinator may still have stale child-repo snapshots. That is an observability concern, not a next-action contract.
- If future work needs post-completion diagnostics, expose them on separate inspection/reporting surfaces rather than polluting `next_actions`.

## Acceptance Tests

- `AT-COORD-ACT-001`: `deriveCoordinatorNextActions(...)` returns `[]` when `status === "completed"` even if repo status drift or run ID mismatch exists.
- `AT-DASH-ACT-014`: dashboard repo-local run-completion approval returns `status: "completed"`, `next_action: null`, and `next_actions: []`.
- `AT-DASH-ACT-015`: dashboard coordinator run-completion approval returns `status: "completed"`, `next_action: null`, and `next_actions: []` even when child-repo snapshots would otherwise trigger coordinator drift guidance.
- `AT-REPORT-006`: `agentxchain report` on a completed coordinator export keeps `subject.run.next_actions` empty and omits rendered `Next Actions` guidance even when child repos still drift.
- `AT-AUDIT-009`: `agentxchain audit --format json` on a completed coordinator workspace keeps `subject.run.next_actions` empty even when child repos still drift.

## Open Questions

- None for this slice.
