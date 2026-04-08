# Coordinator Run Identity Guard Spec

**Status:** Shipped
**Owner:** GPT 5.4
**Depends on:** `MULTI_REPO_ORCHESTRATION_SPEC.md`, `COORDINATOR_BLOCKED_RECOVERY_SPEC.md`

---

## Purpose

Fail closed when a coordinator-tracked child repo silently switches to a different governed `run_id`.

Today the coordinator records a child repo run identity at `multi init`, but later gate evaluation reads only the repo-local `.agentxchain/state.json` at the path. Worse, `resyncFromRepoAuthority()` can silently adopt a new child `run_id`. That is governance drift: the coordinator's audit trail no longer refers to the same repo-local run it dispatched into.

The coordinator must treat repo-run identity as part of the contract, not optional metadata.

## Interface

### Code surfaces

- `cli/src/lib/coordinator-gates.js`
- `cli/src/lib/coordinator-recovery.js`
- `cli/src/commands/multi.js`

### Test surfaces

- `cli/test/coordinator-gates.test.js`
- `cli/test/coordinator-recovery.test.js`
- `cli/test/multi-cli.test.js`

## Behavior

1. Once a coordinator has linked or initialized a child repo run, `state.repo_runs[repo_id].run_id` becomes the expected repo-run identity for that coordinator lifecycle.
2. `evaluatePhaseGate()` must block if a required repo's current `run_id` does not match the coordinator-tracked `run_id`.
3. `evaluateCompletionGate()` must block on the same mismatch.
4. `detectDivergence()` must report repo-run identity drift even when the repo-local `run_id` is missing instead of merely different.
5. `resyncFromRepoAuthority()` must not auto-adopt a different child `run_id`.
6. When resync sees repo-run identity drift, the coordinator enters `blocked`, scaffolds `RECOVERY_REPORT.md`, preserves the original `repo_runs[repo_id].run_id`, and requires explicit operator recovery.
7. `multi step` and `multi resync` inherit this behavior through the library surfaces; they must fail with a clear blocked-state reason instead of progressing.

## Error Cases

| Condition | Behavior |
|---|---|
| Child repo `run_id` changes from expected `run_api_1` to `run_api_2` | Treat as `repo_run_id_mismatch`; block gates and resync |
| Child repo loses `run_id` entirely while coordinator still expects one | Treat as `repo_run_id_mismatch`; block gates and resync |
| Child repo matches expected `run_id` but status changes | Existing divergence / gate logic still applies |

## Acceptance Tests

1. `AT-CR-001e`: divergence detection reports `run_id_mismatch` when a child repo switches away from the coordinator-tracked run.
2. `AT-CG-003b`: phase gate blocks on `repo_run_id_mismatch`.
3. `AT-CG-004b`: completion gate blocks on `repo_run_id_mismatch`.
4. `AT-CR-004b`: resync blocks on repo-run identity drift, preserves the original coordinator `run_id`, and scaffolds the recovery report.
5. `AT-CLI-MR-007b`: `multi step` fails closed and leaves the coordinator blocked when a child repo run identity drifts.

## Open Questions

None. Silent run adoption is rejected.
