# Coordinator Retry Real-Agent Proof Spec

**Status:** completed
**Depends on:** `COORDINATOR_RETRY_SPEC.md`, `DEC-COORD-WAVE-RETRY-001`

## Purpose

Freeze the proof boundary for coordinator retry through real child-repo execution.

The existing coordinator retry coverage proves state transitions and metadata, but it still injects `_executeGovernedRun` and manually mutates repo state. That is weaker than the product contract. The operator surface is not "_execute a callback and pretend the repo turn failed"; it is:

1. `agentxchain mission plan autopilot` dispatches a coordinator workstream
2. the target child repo executes through its configured runtime
3. the workstream enters `needs_attention`
4. the operator runs `agentxchain mission plan launch --workstream <id> --retry`
5. the reissued child-repo turn executes through the same real runtime path
6. the coordinator re-syncs and unblocks downstream work

This slice proves that lifecycle with `local_cli` child runtimes and real staged turn results.

## Interface

### Test surface

`cli/test/e2e-coordinator-retry-real-agent.test.js`

### Supporting fixture

`cli/test-support/coordinator-retry-agent.mjs`

The fixture agent must:

- execute from the child repo's configured `local_cli` runtime
- fail once in `repo-b` without writing a staged result
- succeed on retry by writing a valid staged result
- write valid staged results for the other child-repo turns

## Behavior

### Initial autopilot failure

1. Coordinator workspace contains:
   - workstream `ws-main` on `repo-a` then `repo-b`
   - workstream `ws-followup` on `repo-a` depending on `ws-main`
2. `repo-a` succeeds through the real `local_cli` adapter path.
3. `repo-b` fails on its first execution by exiting without a staged result.
4. Child repo `repo-b` ends with retained active turn status `failed`.
5. Coordinator plan synchronizes `ws-main` to `needs_attention`.
6. Autopilot exits non-zero with `terminal_reason: "failure_stopped"`.

### Targeted retry

1. Operator runs `mission plan launch --workstream ws-main --retry --auto-approve`.
2. Retry reissues only the failed `repo-b` turn.
3. Reissued `repo-b` turn executes through the real `local_cli` runtime.
4. Retry command updates launch metadata:
   - original repo-b dispatch gets `retried_at` and `retry_reason`
   - new repo-b dispatch has `is_retry: true` and `retry_of`
5. After acceptance sync, `ws-main` becomes `completed`.
6. Dependent workstream `ws-followup` becomes `ready`.

### Downstream completion

1. Operator reruns `mission plan autopilot --auto-approve`.
2. `ws-followup` dispatches through the real child runtime.
3. The plan reaches `completed`.

## Error Cases

- The proof is invalid if it injects `_executeGovernedRun`.
- The proof is invalid if it writes `turn-result.json` directly from the test process.
- The proof is invalid if child repo failure is simulated by editing `.agentxchain/state.json` instead of letting the runtime fail.

## Acceptance Tests

- `AT-COORD-RETRY-REAL-001`: initial autopilot run fails through a real child-runtime execution and leaves `ws-main` in `needs_attention`.
- `AT-COORD-RETRY-REAL-002`: the failed child repo retains a real `failed` turn that targeted coordinator retry can reissue.
- `AT-COORD-RETRY-REAL-003`: `mission plan launch --workstream ws-main --retry` succeeds through the real child runtime and preserves retry metadata.
- `AT-COORD-RETRY-REAL-004`: after retry acceptance, dependent workstream `ws-followup` becomes `ready`.
- `AT-COORD-RETRY-REAL-005`: a second autopilot run completes the downstream workstream and finishes the plan.

## Open Questions

1. Should the old mock-heavy `coordinator-retry-e2e.test.js` remain as a narrow metadata/unit-style supplement once the real-agent proof exists, or should it be reduced further?
