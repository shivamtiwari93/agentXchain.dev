# Coordinator Gate Blockers E2E Spec

## Purpose

Prove that coordinator gate blockers are surfaced through the real `agentxchain multi step` CLI path, not only through library-level `evaluatePhaseGate()` / `evaluateCompletionGate()` tests.

Positive coordinator gate flow already has subprocess proof in existing multi-repo E2E tests. The missing boundary is the fail-closed operator path: when no further workstream is assignable and a coordinator gate is not ready, the CLI must print the blocker codes and messages that tell the operator what is actually wrong.

## Interface

One new subprocess E2E suite:

1. `agentxchain multi step`
   - exercised after real coordinator init and real repo-local acceptances
   - asserted through process exit code plus stderr text

## Behavior

### Phase Gate Blockers

- If one repo acceptance has projected and another repo still has an active turn, `multi step` must fail closed.
- The stderr output must include:
  - the gate readiness banner
  - the blocker code for the repo active turn
  - the blocker code for the partially satisfied barrier

### Repo Run Identity Drift

- If repo-local state drifts from the coordinator's recorded run identity, `multi step` must fail closed.
- Because run-id drift is detected during the resync-before-gate path, the operator proof surface is still `multi step` stderr, not a library return value.
- The stderr output must include:
  - the `repo_run_id_mismatch` blocker
  - the coordinator's expected run id
  - the repo's actual run id

## Error Cases

- A gate blocker path that exits nonzero but hides the blocker code is insufficient proof.
- A run-id mismatch message without explicit expected/actual values is insufficient proof because the CLI already has dedicated rendering for those fields.

## Acceptance Tests

- `AT-CGBE-001`: `multi step` surfaces `repo_active_turns` and `barrier_unsatisfied` through stderr when the planning phase is partially satisfied but not ready to advance.
- `AT-CGBE-002`: `multi step` surfaces `repo_run_id_mismatch` plus explicit expected/actual run ids through stderr when a child repo state drifts.

## Open Questions

None. This spec freezes an existing CLI contract that is already implemented in `multi.js`; the gap is subprocess proof, not product behavior design.
