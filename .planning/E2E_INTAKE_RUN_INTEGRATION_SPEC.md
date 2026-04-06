# E2E Intake Run Integration Specification

> CLI-subprocess proof for repo-local intake work continuing through the shipped `agentxchain run` surface.

---

## Purpose

The repo-local intake happy path is only half-proven if it stops at `intake start`. That command assigns the first governed turn and writes the dispatch bundle, but the stronger product claim is that the same work can continue through the automated runner without resetting state or starting a second run.

This slice proves one truthful path:

`record -> triage -> approve -> plan -> start -> run -> resolve`

It rejects the lazy shortcut of staging a synthetic turn result and calling `accept-turn`. The point here is not "can the intent close somehow?" The point is whether the public `run` command can adopt an intake-started turn and finish the same governed run.

---

## Interface

### Test File

- `cli/test/e2e-intake-run-integration.test.js`

### Supporting Contract

- The test uses real CLI subprocesses for:
  - `agentxchain intake record`
  - `agentxchain intake triage`
  - `agentxchain intake approve`
  - `agentxchain intake plan`
  - `agentxchain intake start`
  - `agentxchain run`
  - `agentxchain intake resolve`
- The governed repo fixture may be scaffolded directly on disk before the CLI sequence begins.
- Adapter execution must go through a shipped runtime path (`local_cli` with the existing mock agent fixture). No direct writes to the staging result path are allowed in this test.

---

## Behavior

### Scenario

1. Create a temporary governed repo fixture.
2. Patch the fixture so all roles use the existing `local_cli` mock agent and can run through `agentxchain run`.
3. Record a manual intake event through `agentxchain intake record --json`.
4. Triage, approve, and plan the intent through the real CLI.
5. Start the planned intent through `agentxchain intake start --json`.
6. Capture the returned `run_id` and `turn_id`.
7. Prove that `intake resolve` does not close the intent while the run is still active.
8. Run `agentxchain run --auto-approve --max-turns 10`.
9. Resolve the linked intent through `agentxchain intake resolve --json`.

### Assertions

The test must prove all of the following:

1. `intake start` returns a real `run_id` and `turn_id` and assigns the entry-role turn into governed state.
2. `agentxchain run` adopts that existing active turn instead of creating a different run.
3. The final governed state keeps the same `run_id` that `intake start` created.
4. The governed run reaches `completed` through real adapter dispatch and gate approval.
5. The run history includes the intake-started turn id.
6. `intake resolve` before run completion is a no-op (`no_change: true`) while the intent stays `executing`.
7. `intake resolve` after run completion transitions the same intent from `executing` to `completed`.
8. The completed intent records the linked `run_id`, final turn id, and observation directory scaffold.

### Explicit Non-Scope

- no multi-repo coordinator path
- no blocked-path or recovery-path coverage
- no manual staging of `turn-result.json`
- no release workflow work

---

## Error Cases

1. If `agentxchain run` initializes a new run instead of adopting the intake-started run, the proof is invalid.
2. If the test writes the turn result directly to staging, the proof is invalid. That would bypass the runner surface being tested.
3. If `intake resolve` can close the intent before the governed run is terminal, the proof should fail because that would violate repo authority.
4. If the mock runtime cannot satisfy the real gate requirements, the test should fail rather than weakening the governed config.

---

## Acceptance Tests

### AT-E2E-INTAKE-RUN-001: intake-started turn completes through `agentxchain run`

Given a planned repo-local intake intent, when the operator runs:

`intake start -> run -> intake resolve`

then:

- `run` continues the exact run created by `intake start`
- the governed state reaches `completed`
- the intent remains `executing` until `intake resolve`
- the final intent reaches `completed` with correct run linkage and observation scaffold

---

## Open Questions

None. This slice is narrow and executable.
