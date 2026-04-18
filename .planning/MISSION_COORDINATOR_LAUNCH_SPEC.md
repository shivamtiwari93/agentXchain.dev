# Mission Coordinator Launch Spec

**Status:** proposed
**Author:** GPT 5.4 — Turn 134

## Purpose

Define the first real execution bridge between repo-local `mission plan launch` and the multi-repo coordinator.

The current mission/coordinator bridge already covers:
- mission binding to a coordinator run
- coordinator-aware plan generation
- coordinator phase alignment validation

It does **not** yet make `mission plan launch` truthful for coordinator-bound missions. The existing single-repo launch path allocates a `chain_id`, runs a repo-local chain, and marks outcomes from a chain report. That model is wrong for coordinator workstreams, which dispatch repo-local turns incrementally and converge through coordinator acceptance projections and barrier state.

This spec closes that lie with a bounded cut:
- `mission plan launch --workstream <id>` can dispatch the next repo-local assignment for a coordinator-backed workstream
- plan launch records can represent coordinator dispatches instead of only `chain_id`
- `mission plan show` can synchronize coordinator-backed workstreams from coordinator history/barriers

## Interface

### Coordinator-backed launch record

For coordinator-backed workstreams, `launch_records[]` may contain:

```json
{
  "workstream_id": "ws-auth-rollout",
  "dispatch_mode": "coordinator",
  "super_run_id": "srun_1713400000_abc12345",
  "launched_at": "2026-04-18T00:10:00.000Z",
  "status": "launched",
  "completion_barrier": {
    "barrier_id": "ws-auth-rollout_completion",
    "type": "all_repos_accepted"
  },
  "repo_dispatches": [
    {
      "repo_id": "api",
      "repo_turn_id": "turn_abc123",
      "role": "dev",
      "dispatched_at": "2026-04-18T00:10:00.000Z",
      "bundle_path": "/abs/path/.agentxchain/dispatch/turns/turn_abc123",
      "context_ref": "ctx_..."
    }
  ]
}
```

Rules:
- `dispatch_mode: "coordinator"` distinguishes this from single-repo chain launches.
- A coordinator-backed workstream reuses the same launch record across successive repo dispatches.
- `repo_dispatches[]` is append-only audit history.
- Legacy chain launch records remain valid.

### CLI: `mission plan launch`

For coordinator-bound missions:

```bash
agentxchain mission plan launch latest --workstream ws-auth-rollout
```

Behavior:
1. Load the bound coordinator config/state from the mission artifact.
2. Verify the requested workstream exists in the coordinator config.
3. Verify the coordinator is currently in the workstream's phase.
4. Select the next assignable repo for that specific workstream using coordinator semantics.
5. Dispatch the repo-local turn via the existing coordinator dispatcher.
6. Update the plan launch record in coordinator mode.

JSON output includes:
- `dispatch_mode`
- `super_run_id`
- `repo_id`
- `repo_turn_id`
- `role`
- `workstream_status`
- `launch_record`

### CLI: `mission plan show`

For coordinator-bound plans, `mission plan show` synchronizes the loaded plan against:
- coordinator `acceptance_projection` history
- completion barrier state

The synchronized view surfaces:
- updated `launch_status` for coordinator-backed workstreams
- `coordinator_progress` per workstream with:
  - `accepted_repo_ids`
  - `pending_repo_ids`
  - `completion_barrier_status`
  - `repo_count`
  - `accepted_repo_count`

## Behavior

### Coordinator launch selection

`mission plan launch --workstream <id>` must not bypass coordinator routing rules.

It must fail when:
- the workstream is not declared in the coordinator config
- the coordinator is in a different phase
- the targeted workstream has unsatisfied plan dependencies
- the targeted workstream has no assignable repo right now

It must not silently fall back to the single-repo chain path.

### Completion synchronization

Coordinator-backed workstreams do not complete from chain reports.

Instead:
- accepted repo projections count toward workstream progress
- a satisfied completion barrier marks the workstream completed
- once completed, dependent blocked workstreams become `ready`
- if all workstreams complete, the plan becomes `completed`

### Fail-closed boundaries for this slice

This slice does **not** productize full coordinator wave execution.

Until that exists:
- `mission plan launch --all-ready` is invalid for coordinator-bound missions
- `mission plan autopilot` is invalid for coordinator-bound missions
- `mission plan launch --retry` remains single-repo only

Do not fake batch multi-repo execution by reusing the repo-local chain launcher.

## Error Cases

- Bound mission points to missing/unreadable coordinator workspace
- Coordinator state is missing or not active
- Requested workstream exists in the plan but not in the coordinator config
- Requested workstream phase differs from the coordinator's current phase
- Target workstream is already completed
- No repo is assignable because the entry repo is busy/blocked or a barrier prevents downstream dispatch

## Acceptance Tests

- `AT-MISSION-COORD-LAUNCH-001`: coordinator-bound `mission plan launch --workstream <id>` dispatches the targeted workstream through the coordinator and writes a coordinator-mode launch record instead of allocating a `chain_id`
- `AT-MISSION-COORD-LAUNCH-002`: a second launch after one repo acceptance appends a second `repo_dispatches[]` entry to the same launch record
- `AT-MISSION-COORD-LAUNCH-003`: `mission plan show --json` synchronizes accepted repos and completion barrier state into coordinator-backed workstream progress
- `AT-MISSION-COORD-LAUNCH-004`: when the completion barrier is satisfied, the coordinator-backed workstream becomes `completed` and dependent workstreams become `ready`
- `AT-MISSION-COORD-LAUNCH-005`: `mission plan launch --all-ready` fails closed for coordinator-bound missions
- `AT-MISSION-COORD-LAUNCH-006`: `mission plan autopilot` fails closed for coordinator-bound missions

## Open Questions

1. Should a later slice let `mission plan launch --all-ready` run one coordinator dispatch per ready workstream, or should batch execution stay on `multi`?
2. Should plan launch records eventually capture per-repo terminal outcomes directly, or is coordinator history the durable source of truth with launch records acting as an index?
