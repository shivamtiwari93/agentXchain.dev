# Coordinator Hooks Acceptance Truth Spec

> `DEC-COORD-HOOKS-E2E-001` — coordinator hook E2E must observe real staged-result acceptance, not hand-written repo state

## Purpose

Keep coordinator hook E2E tests honest. A hook test that writes repo-local `state.json` or `history.jsonl` directly is not testing the hook surface the product ships. It bypasses schema validation, acceptance projection, barrier updates, and final-phase checks, and can create repo states that the CLI would reject.

## Interface

- Target test: `cli/test/e2e-coordinator-hooks.test.js`
- Acceptance path under test:
  - write staged result to `getTurnStagingResultPath(turn_id)`
  - run `agentxchain accept-turn` in the child repo
  - let `multi step` resync and fire coordinator hooks from real acceptance projections

## Behavior

1. Coordinator hook E2E helpers must stage a valid turn result and call real `accept-turn`.
2. Planning-phase acceptances that are meant to unlock implementation must include `phase_transition_request: 'implementation'`.
3. Final-phase acceptances that are meant to complete a repo run must use `run_completion_request: true`.
4. Hook assertions must match real accepted-turn payloads:
   - `decisions` are structured decision objects, not synthetic string IDs.
   - `verification` reflects the turn-result schema (`status`, optional `machine_evidence`), not invented top-level `exit_code`.
   - `projection_ref` assertions must match the real coordinator projection format.

## Error Cases

| Condition | Behavior |
|---|---|
| Test writes repo-local state/history directly | Reject the helper. The test is bypassing the shipped acceptance path. |
| Planning acceptance omits phase transition but later claims implementation work | Treat as invalid test setup; the repo never entered the implementation phase truthfully. |
| Hook payload assertions depend on fake helper-only shapes | Update the assertions to match the real accepted-turn schema. |

## Acceptance Tests

- AT-CHT-001: `e2e-coordinator-hooks.test.js` contains no direct acceptance helper that edits repo-local `state.json` or `history.jsonl`.
- AT-CHT-002: `AT-CR-005` triggers `after_acceptance` through staged-result + real `accept-turn`, then proves tamper detection still blocks the coordinator.
- AT-CHT-003: `AT-CR-007` uses real accepted planning turns with `phase_transition_request: 'implementation'` before asserting the blocked gate.
- AT-CHT-004: `AT-CR-009` and `AT-CR-010` assert real payload shapes for `decisions`, `verification`, and `projection_ref`.

## Open Questions

None. Full child execution via `step --resume` is a separate proof bar. For coordinator hook lifecycle, staged result + real `accept-turn` is the minimum honest surface.
