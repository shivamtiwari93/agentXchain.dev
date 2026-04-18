# Coordinator Wave Failure — Real Agent Proof Spec

## Status

Completed

## Purpose

Prove that coordinator autopilot wave-failure handling works through real `local_cli` child runtimes instead of injected `_executeGovernedRun` callbacks. The existing `coordinator-wave-failure-e2e.test.js` uses synthetic `_executeGovernedRun` mocks that bypass the real adapter path, hiding potential product bugs in dispatch, execution, state transitions, and acceptance projection.

## Prior Art

- `e2e-coordinator-child-run.test.js` — coordinator happy-path through real `step --resume`
- `e2e-coordinator-recovery-real-agent.test.js` — coordinator blocked→resume→complete through real agents
- `e2e-coordinator-retry-real-agent.test.js` — coordinator retry through real child runtimes

All three eliminated synthetic `_executeGovernedRun`/`stageAcceptedTurn` patterns. This spec does the same for the wave-failure path.

## Interface

Test file: `cli/test/coordinator-wave-failure-e2e.test.js` (rewrite, not new file)

Mock agent: `cli/test-support/coordinator-wave-failure-agent.mjs`
- `repo-a`: always exits with code 1 (no staged result) — simulates execution failure
- `repo-b`: writes staged result and exits with code 0

## Behavior

### Test 1 — AT-COORD-WAVE-FAIL-001: failure stops wave (no --continue-on-failure)

1. Create coordinator workspace with two independent workstreams: ws-a → repo-a, ws-b → repo-b
2. Both repos use `local_cli` runtime pointing to `coordinator-wave-failure-agent.mjs`
3. Workstream order: `['ws-a', 'ws-b']` — ws-a dispatches first
4. Run coordinator autopilot WITHOUT `continueOnFailure`
5. repo-a agent exits with code 1
6. Wave loop stops → ws-b is never dispatched
7. Terminal reason: `failure_stopped`

### Test 2 — AT-COORD-WAVE-FAIL-002: continue-on-failure dispatches remaining workstreams

1. Same workspace but workstream order: `['ws-b', 'ws-a']` — ws-b dispatches first
2. Run coordinator autopilot WITH `continueOnFailure: true`
3. repo-b agent succeeds → ws-b completed
4. repo-a agent exits with code 1 → ws-a needs_attention
5. Terminal reason: `plan_incomplete` or `failure_stopped`

## Error Cases

- Test is **invalid** if it passes `_executeGovernedRun` to the autopilot options
- Test is **invalid** if it calls `recordFailedRepoTurn()`, `recordAcceptedRepoTurn()`, `appendAcceptanceProjection()`, or `setBarrierSatisfied()` directly
- Test is **invalid** if it writes `turn-result.json` or `state.json` directly for any child repo turn

## Acceptance Tests

- AT-COORD-WAVE-FAIL-001: Without `--continue-on-failure`, autopilot exits with code 1 and `failure_stopped`, only one wave runs, ws-b is not dispatched
- AT-COORD-WAVE-FAIL-002: With `--continue-on-failure`, ws-b is dispatched and completed, ws-a is `needs_attention`, terminal reason is `plan_incomplete` or `failure_stopped`
- AT-COORD-WAVE-FAIL-003: No `_executeGovernedRun` mock is present anywhere in the test file
- AT-COORD-WAVE-FAIL-004: repo-b agent-written artifacts exist on disk after successful dispatch (proves real execution happened)

## Open Questions

None.
