# BUG-62 Operator Commit Reconcile Spec

## Purpose

Allow an operator to accept safe manual commits made on top of the last governed checkpoint as the new run baseline without editing `.agentxchain/state.json` by hand.

BUG-62 exists because the current continuity surface can detect `Git HEAD has moved since checkpoint`, but it has no protocol command that says "these operator commits are intentional; use this HEAD as the next governed baseline." That strands future agent work after otherwise safe manual recovery commits.

## Interface

- CLI:
  - `agentxchain reconcile-state --accept-operator-head`
- State:
  - update `state.accepted_integration_ref` to `git:<current HEAD>`
  - add `state.operator_commit_reconciliation` with timestamp, previous baseline, accepted head, commit count, and safety mode
- Session checkpoint:
  - update `.agentxchain/session.json.baseline_ref` to the current repo baseline
  - set `checkpoint_reason: "operator_commit_reconciled"`
- Event log:
  - emit `state_reconciled_operator_commits`
  - payload includes previous baseline, accepted head, accepted commits, touched paths, and safety checks

## Behavior

1. Resolve the previous baseline from `.agentxchain/session.json.baseline_ref.git_head`, then `state.accepted_integration_ref`, then `state.last_completed_turn.checkpoint_sha`.
2. Resolve current `HEAD`.
3. If current `HEAD` equals the previous baseline, return a no-op success.
4. Require the previous baseline to be an ancestor of current `HEAD`.
5. Walk every commit in `previous..HEAD`.
6. Reject if any accepted commit modifies `.agentxchain/`.
7. Reject if any accepted commit deletes critical governed evidence files such as `.planning/acceptance-matrix.md`.
8. On success, update state/session baselines and emit the event.

## Error Cases

- No governed project: command exits with setup guidance.
- No git repository or no HEAD: refuse with an actionable error.
- No prior baseline: refuse because the command cannot prove what is being reconciled.
- Previous baseline is not an ancestor of HEAD: refuse as `history_rewrite`.
- Operator commit modifies `.agentxchain/`: refuse as `governance_state_modified`.
- Operator commit deletes critical governed evidence: refuse as `critical_artifact_deleted`.

## Acceptance Tests

- `AT-BUG62-001`: checkpoint baseline at SHA A, operator commits product file at SHA B, `agentxchain status` reports drift, `agentxchain reconcile-state --accept-operator-head` succeeds, state/session baselines point at B, event lists the accepted commit and touched path, and `status --json` no longer reports HEAD drift.
- `AT-BUG62-002`: same setup but operator commit modifies `.agentxchain/state.json`; reconcile refuses with `governance_state_modified` and names the offending path.
- `AT-BUG62-003`: same setup but baseline is no longer an ancestor of HEAD; reconcile refuses with `history_rewrite`.

## Open Questions

- Automatic continuous-mode reconciliation (`reconcile_operator_commits: "manual" | "auto_safe_only" | "disabled"`) should build on this manual primitive in the next slice.
- The v1 critical-artifact deletion list is intentionally narrow. Future slices may add project-configurable protected paths.
