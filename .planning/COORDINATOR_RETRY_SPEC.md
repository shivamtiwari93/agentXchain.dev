# Coordinator Retry Spec

**Status:** partial
**Author:** Claude Opus 4.6 — Turn 151
**Depends on:** `COORDINATOR_WAVE_EXECUTION_SPEC.md`, `DEC-COORD-WAVE-RETRY-001`, `DEC-MISSION-COORD-FAILURE-001`

## Purpose

Define when and how retry is safe for coordinator-backed mission workstreams. Phase 1 ships targeted `mission plan launch --workstream <id> --retry`. Coordinator autopilot `--auto-retry` remains deferred until the retry safety model is proven in operator-initiated flows.

Today, coordinator workstream failures are terminal within a wave session. When a repo-local turn fails acceptance or execution, the workstream enters `needs_attention`, autopilot either stops (`failure_stopped`) or skips (`plan_incomplete`), and the operator must manually diagnose, fix, reissue in the child repo, and re-run autopilot. This is correct-by-default (DEC-COORD-WAVE-RETRY-001) because repo B may depend on repo A's failed output.

This spec defines the safety boundaries, invalidation rules, and barrier interactions that make coordinator retry safe under constrained conditions.

**Shipped in Phase 1**

- targeted coordinator `--retry` for one active retryable repo failure in a `needs_attention` workstream
- retry metadata on the coordinator launch record (`retried_at`, `retry_reason`, `is_retry`, `retry_of`)
- `coordinator_retry` event emission and coordinator history/decision ledger entries
- explicit retry-output warning metadata when repo-local retry succeeds but coordinator acceptance projection cannot be recorded immediately

**Deferred**

- unattended `mission plan autopilot --auto-retry`
- multi-failure coordinator retries in one command
- retry support for repo-local failure states that do not map cleanly onto the active-turn `reissueTurn()` primitive

## Core Concepts

### When is coordinator retry safe?

Retry is safe when ALL of these hold:

1. **The failure is repo-local.** The failed turn did not corrupt coordinator state, barrier projections, or other repos' working trees. Coordinator-level retry only invalidates the failed repo's dispatch — it does not roll back accepted state in other repos.

2. **No downstream repo has consumed the failed repo's output.** If workstream `ws-api` failed and `ws-web` (which depends on `ws-api`) has already launched using `ws-api`'s partial output, retrying `ws-api` creates a divergence. The retry guard must verify that no dependent workstream has dispatched since the failed repo's turn was issued.

3. **The failed repo is in a retryable state.** Phase 1 only retries repo-local turns that are still active and whose current failure state is `failed` or `failed_acceptance`. Turns in `conflicted`, `retrying`, `needs_human`, or already-cleared terminal states require operator intervention, not coordinator retry.

### Retryable failure states

| Failure status | Retryable? | Retry action |
|---|---|---|
| `failed` | Yes | `reissueTurn` in child repo |
| `failed_acceptance` | Yes | `reissueTurn` in child repo |
| `rejected` | No in Phase 1 | Use repo-local recovery. Revisit when coordinator retry can reason about the retained turn correctly. |
| `retrying` | No — already in retry | Wait for retry to complete |
| `conflicted` | No — needs operator | Operator resolves conflict first |
| `needs_human` | No — needs operator | Operator handles escalation first |

### What retry does

1. **Invalidates the failed repo dispatch** in the coordinator launch record: marks it with `retried_at` and `retry_reason`.
2. **Calls `reissueTurn`** in the child repo with the same role and runtime resolution. The reissued turn gets a fresh baseline from current HEAD.
3. **Appends a new repo dispatch** to the launch record's `repo_dispatches[]` for the same `(workstream, repo)` pair.
4. **Transitions the workstream** from `needs_attention` back to `launched` (since a new dispatch is now in flight).
5. **Re-syncs coordinator plan state** to update barrier projections.

### What retry does NOT do

- **Does not roll back other repos.** Accepted turns in sibling repos within the same workstream are untouched.
- **Does not re-evaluate barriers.** Barrier satisfaction is only re-evaluated during `synchronizeCoordinatorPlanState`, which retry triggers.
- **Does not reset `accepted_repo_ids`.** A repo that was already accepted stays accepted. Only the failed repo is retried.
- **Does not auto-fix the root cause.** The operator must fix the underlying issue (code bug, config error, runtime problem) before retry will succeed. Retry without a fix is just re-running the same failure.

## Interface

### `mission plan launch --workstream <id> --retry` (targeted retry)

```bash
agentxchain mission plan launch latest --workstream ws-api --retry
```

Behavior:

1. Load plan, coordinator config, coordinator state.
2. Validate the workstream is in `needs_attention` with at least one retryable repo failure.
3. For each retryable failed repo in the workstream:
   a. Verify no dependent workstream has dispatched since the failure.
   b. Call `reissueTurn` in the child repo.
   c. Update the launch record: mark old dispatch as retried, append new dispatch.
4. Transition workstream from `needs_attention` to `launched`.
5. Execute the reissued turn(s) via normal dispatch-wait-sync.
6. Re-synchronize plan state.

Flags:
- `--retry` — required to enter retry mode. Without it, `launch --workstream` for a `needs_attention` workstream fails with guidance.
- `--max-retries <N>` — per-repo retry ceiling within a single autopilot session (default: 1). Prevents infinite retry loops.

### `mission plan autopilot --auto-retry` (unattended retry, deferred)

```bash
agentxchain mission plan autopilot latest --auto-retry [--max-retries N]
```

Behavior within the wave loop once implemented:

1. After a workstream enters `needs_attention`:
   a. Check if `--auto-retry` is set.
   b. Check if any failed repo has retries remaining (below `--max-retries`).
   c. Check safety conditions (no downstream dispatch since failure).
   d. If all conditions pass: retry the failed repo(s) within the same wave.
   e. If conditions fail: fall through to normal `--continue-on-failure` / `failure_stopped` logic.
2. Track retry count per `(workstream, repo)` pair within the session.
3. When `--max-retries` is exhausted for a repo: treat as permanent failure (same as no `--auto-retry`).

`--auto-retry` is deliberately **not shipped** in Phase 1. The interaction matrix with `--continue-on-failure` remains open until targeted retry hardens.

### Retry record structure

```json
{
  "repo_dispatches": [
    {
      "repo_id": "api",
      "repo_turn_id": "turn_abc",
      "role": "dev",
      "dispatched_at": "2026-04-18T12:00:00Z",
      "retried_at": "2026-04-18T12:30:00Z",
      "retry_reason": "failed_acceptance"
    },
    {
      "repo_id": "api",
      "repo_turn_id": "turn_def",
      "role": "dev",
      "dispatched_at": "2026-04-18T12:30:00Z",
      "is_retry": true,
      "retry_of": "turn_abc"
    }
  ]
}
```

## Behavior

### Safety guard: downstream dispatch check

Before retrying a failed repo dispatch for workstream `ws-A`:

1. Enumerate all workstreams that declare a dependency on `ws-A`.
2. For each dependent workstream, check if any `repo_dispatches` were created AFTER the failed dispatch's `dispatched_at`.
3. If yes: refuse retry with error: "Dependent workstream `ws-B` has already dispatched since `ws-A` failed. Manual intervention required — downstream work may have consumed partial output."
4. If no: retry is safe.

This is conservative. A future optimization could check whether the dependent workstream's dispatch actually consumed any of the failed repo's artifacts. For now, any post-failure dispatch in a dependent workstream blocks retry.

### Retry within autopilot waves

When `--auto-retry` is set and a workstream enters `needs_attention` during a wave:

1. The wave pauses dispatch of new workstreams.
2. For each failed repo in the workstream:
   a. Check retry budget (`session_retries[(ws_id, repo_id)] < max_retries`).
   b. Check safety guard (no downstream dispatch since failure).
   c. If both pass: reissue the turn, increment retry counter, append new dispatch.
   d. If either fails: mark repo as permanently failed for this session.
3. If any repos were successfully reissued:
   a. Transition workstream back to `launched`.
   b. Wait for the reissued turn(s) to reach terminal state.
   c. Re-sync plan state.
   d. If the retry succeeds: the workstream proceeds normally (pending repos dispatched in later waves).
   e. If the retry fails again: the workstream re-enters `needs_attention`. If retries exhausted, fall through to `--continue-on-failure` / `failure_stopped`.
4. Resume wave dispatch for other workstreams.

### Retry count tracking

Retry counts are per-session, not persistent. Each `autopilot` invocation starts with zero retries. If the operator re-runs autopilot, the retry budget resets. This prevents session state from accumulating and gives the operator a clean retry surface after fixing issues.

Retry counts are tracked as `Map<string, number>` keyed by `${workstream_id}:${repo_id}`.

### Barrier interaction

Retry does NOT reset barrier state:
- `accepted_repo_ids` is not modified (already-accepted repos stay accepted).
- `completion_barrier.status` is not modified (if another repo's acceptance already partially satisfied the barrier, that progress is preserved).
- After a successful retry, `synchronizeCoordinatorPlanState` re-evaluates barriers normally. If the retried repo's turn is now accepted, it joins `accepted_repo_ids` and the barrier may transition to `satisfied`.

### Event emission

Retry emits:
- `coordinator_retry` event to `events.jsonl` with: `workstream_id`, `repo_id`, `failed_turn_id`, `reissued_turn_id`, `retry_count`, `retry_reason`.
- The reissued turn's normal lifecycle events (`turn_dispatched`, etc.) propagate as usual.

### Projection warning visibility

If the retried repo-local turn executes successfully but the coordinator cannot append the matching `acceptance_projection` entry immediately, the retry command must:

1. keep the retry result as a success (the repo-local turn already ran),
2. print a warning on stderr for human operators, and
3. include machine-readable warning metadata in JSON output:

```json
{
  "retry": true,
  "warnings": [
    {
      "code": "coordinator_acceptance_projection_incomplete",
      "message": "Accepted turn turn_123 not found in repo-local history for repo-b."
    }
  ],
  "reconciliation_required": true
}
```

This is not a hard failure because the child repo execution already completed. It is also not allowed to stay stderr-only because operators, tests, and downstream tooling need an explicit signal that the coordinator view still requires reconciliation.

## Error Cases

| Condition | Behavior |
|---|---|
| `--retry` on a non-`needs_attention` workstream | Error: "Workstream `ws-X` is not in needs_attention state. Nothing to retry." |
| `--retry` on a workstream with only non-retryable failures (`conflicted`, `needs_human`) | Error: "No retryable failures in workstream `ws-X`. Failed repos require manual intervention: [list]." |
| `--retry` blocked by downstream dispatch | Error: "Cannot retry `ws-X` — dependent workstream `ws-Y` has dispatched since the failure. Resolve manually." |
| `--auto-retry` with `--max-retries 0` | Error: "--max-retries must be >= 1 when --auto-retry is set." |
| `reissueTurn` fails in child repo (e.g., dirty working tree) | Retry fails for that repo. Log the error. If other repos in the workstream are retryable, continue with those. |
| Retry succeeds but the retried turn fails again | Workstream re-enters `needs_attention`. Retry count incremented. If budget exhausted, treated as permanent failure. |

## Acceptance Tests

- `AT-COORD-RETRY-001`: `mission plan launch --workstream ws-X --retry` reissues a failed repo turn, appends a new dispatch to the launch record, and transitions the workstream from `needs_attention` to `launched`.
- `AT-COORD-RETRY-002`: `--retry` refuses to retry when a dependent workstream has dispatched since the failure.
- `AT-COORD-RETRY-003`: `--retry` refuses to retry non-retryable failure states (`conflicted`, `needs_human`).
- `AT-COORD-RETRY-004` through `AT-COORD-RETRY-007` are deferred with coordinator autopilot `--auto-retry`.
- `AT-COORD-RETRY-008`: Barrier state is preserved through retry — accepted repos remain accepted, barrier progress is not reset.
- `AT-COORD-RETRY-009`: Retry record structure includes `retried_at`, `retry_reason`, `is_retry`, and `retry_of` fields.
- `AT-COORD-RETRY-010`: `coordinator_retry` event is emitted with correct provenance fields.
- `AT-COORD-RETRY-011`: When retry execution succeeds but `acceptance_projection` cannot be recorded immediately, JSON output includes a warning entry with code `coordinator_acceptance_projection_incomplete` and sets `reconciliation_required: true`.

## Open Questions

1. **Cross-repo retry ordering.** Phase 1 fails closed when a workstream has multiple retryable repo failures. If we later support multiple retries in one command, should it preserve original dispatch order or retry all simultaneously?

2. **Persistent retry state.** Only relevant once unattended `--auto-retry` ships. Targeted coordinator retry is operator-initiated and intentionally has no session counter.

3. **Retry with changed code.** The reissued turn uses a fresh baseline from current HEAD. We do not yet record a baseline diff in the coordinator retry record. Add one only if operators actually need that audit detail.
