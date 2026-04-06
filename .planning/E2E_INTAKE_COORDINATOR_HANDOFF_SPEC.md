# E2E Intake Coordinator Handoff Proof Spec

**Status:** Shipped
**Owner:** GPT 5.4
**Depends on:** `INTAKE_COORDINATOR_HANDOFF_SPEC.md`, `MULTI_REPO_ORCHESTRATION_SPEC.md`, `E2E_INTAKE_LIFECYCLE_SPEC.md`

---

## Purpose

Prove the highest-value unverified workflow-kit path with real CLI subprocesses:

1. A repo-local intake signal becomes a planned intent.
2. The source repo hands that intent to a coordinator workstream with `intake handoff`.
3. The coordinator dispatches real child-repo turns with `multi step`.
4. Child repos accept those turns through `accept-turn`.
5. The coordinator reaches a satisfied completion barrier and closes through `multi approve-gate`.
6. The source repo remains authoritative and closes the intent only when `intake resolve` is run there.

This is the first proof that intake-to-coordinator handoff is not just a file contract. It is a runnable operator workflow.

---

## Interface

### New proof surface

- Test file: `cli/test/e2e-intake-coordinator-handoff.test.js`

### Commands exercised

- `agentxchain intake record`
- `agentxchain intake triage`
- `agentxchain intake approve`
- `agentxchain intake plan`
- `agentxchain multi init`
- `agentxchain intake handoff`
- `agentxchain multi step`
- `agentxchain accept-turn`
- `agentxchain multi approve-gate`
- `agentxchain intake resolve`

### Runtime strategy

- Child repos use governed manual/local runtimes so the proof can stage real turn-result artifacts deterministically.
- The proof must write staged turn results to the per-turn path from `getTurnStagingResultPath(turn_id)`.
- The proof must not mutate coordinator `barriers.json`, coordinator `state.json`, or intake intent files directly to simulate success.

---

## Behavior

### Happy-path contract

1. Create a coordinator workspace with two governed child repos: `api` and `web`.
2. Record, triage, approve, and plan an intake intent in `api`.
3. Commit planned artifacts so the source repo has a clean git baseline before coordinated execution.
4. Initialize the coordinator with `multi init`.
5. Handoff the planned intent from `api` to coordinator workstream `delivery`.
6. Before any coordinator work is accepted, `intake resolve` in `api` must report `no_change` and preserve `executing`.
7. `multi step` must dispatch a real turn into `api`.
8. Accept the dispatched `api` turn with a staged turn result via `accept-turn`.
9. `multi step` must dispatch a real downstream turn into `web`.
10. The dispatched coordinator context must include the intake handoff snapshot for the current workstream.
11. Accept the dispatched `web` turn with a staged turn result via `accept-turn`.
12. `multi step` must request coordinator completion.
13. `multi approve-gate` must complete the coordinator run.
14. Only then may `intake resolve` in `api` transition the source intent from `executing` to `completed`.

### Authority contract

- Coordinator progress does not auto-close the source intent.
- The source repo remains the sole owner of intake state transitions.
- The proof must show this explicitly by calling `intake resolve` once before coordinator completion and once after.

---

## Error Cases

- If the proof toggles coordinator barrier files directly, it is invalid. That only proves `resolveIntent()` reads snapshots.
- If the proof bypasses `accept-turn` by editing governed state/history directly, it is invalid. That only proves resync logic against forged repo authority.
- If the proof never calls `intake resolve` before coordinator completion, it fails to prove source-repo authority.
- If the proof never inspects coordinator context for the handoff payload, it misses the reason the sibling repo can act on the source signal.

---

## Acceptance Tests

1. `AT-HANDOFF-E2E-001`: `intake handoff` followed by immediate `intake resolve` preserves `executing` with `no_change: true` before coordinator completion.
2. `AT-HANDOFF-E2E-002`: `multi step` dispatches `api` first, then `web`, and both repos can close their assigned turns through staged results plus `accept-turn`.
3. `AT-HANDOFF-E2E-003`: The downstream `web` coordinator context includes the current-workstream intake handoff snapshot for the source intent.
4. `AT-HANDOFF-E2E-004`: After both repo acceptances, `multi step` requests run completion and `multi approve-gate` completes the coordinator run.
5. `AT-HANDOFF-E2E-005`: Final `intake resolve` in the source repo transitions the intent to `completed`, preserving source-repo authority over the terminal intake state.

---

## Open Questions

1. Should a follow-on E2E slice prove the blocked coordinator path (`intake resolve` -> `blocked`) with real subprocesses rather than only targeted tests?
2. Should a future proof cover `agentxchain run` as the execution driver for intake-originated repo-local work, or is the current `accept-turn`-driven proof sufficient for now?
