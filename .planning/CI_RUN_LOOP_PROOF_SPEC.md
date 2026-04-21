# CI Run-Loop Composition Proof Spec

## Purpose

Prove that the `runLoop` library composes governed execution correctly as a reusable engine. This is a **separate proof boundary** from the primitive runner-interface proof (`run-to-completion.mjs`). The primitive proof validates raw operations. This proof validates library composition: callback delegation, gate handling, rejection/retry flow, stop-reason typing, and event emission.

## Scope

- One proof script: `examples/ci-runner-proof/run-with-run-loop.mjs`
- One contract test: `cli/test/ci-run-loop-proof-contract.test.js`
- Covered by `cli/scripts/prepublish-gate.sh` through the local `npm test` gate

## Interface

The proof script uses only:
- `runLoop` from `cli/src/lib/run-loop.js`
- `loadState` from `cli/src/lib/runner-interface.js` (for scaffolding only, not for driving turns)
- Standard `fs`/`path`/`os`/`crypto` for scaffolding

The proof does **not** import `initRun`, `assignTurn`, `acceptTurn`, `rejectTurn`, `writeDispatchBundle`, `getTurnStagingResultPath`, `approvePhaseGate`, or `approveCompletionGate` — those are `runLoop`'s responsibility.

## Behavior

The proof executes a 3-turn governed lifecycle (PM → Dev → QA) via `runLoop` callbacks:

1. **PM turn** — accepted. Files planning artifacts. Requests phase transition to implementation.
2. **Phase gate** — `approveGate('phase_transition', ...)` called by `runLoop`. Callback approves.
3. **Dev turn (attempt 1)** — rejected. Dispatch callback returns `{ accept: false, reason: ... }`.
4. **Dev turn (attempt 2)** — accepted on retry (same `turn_id`). Requests phase transition to QA.
5. **Auto-advance** — implementation→QA gate has no `requires_human_approval`, auto-advances.
6. **QA turn** — accepted. Files ship artifacts. Requests run completion.
7. **Completion gate** — `approveGate('run_completion', ...)` called. Callback approves.
8. **Result** — `stop_reason: 'completed'`, `ok: true`.

## Output Contract

### Text mode (default)
```
CI Run-Loop Composition Proof — AgentXchain run-loop v<version>
  Run:     <run_id>
  Roles:   pm -> dev -> qa
  Reject:  1 rejection, retry on same turn_id
  Gates:   phase_transition=approved, run_completion=approved
  Events:  <count> lifecycle events captured
  Result:  PASS — runLoop drove governed lifecycle to completion
```

### JSON mode (`--json`)
```json
{
  "runner": "ci-run-loop-composition-proof",
  "runner_interface_version": "<version>",
  "result": "pass",
  "stop_reason": "completed",
  "turns_executed": 3,
  "roles": ["pm", "dev", "qa"],
  "gates_approved": 2,
  "turn_history": [...],
  "rejection_count": 1,
  "event_types": [...],
  "event_count": <number>,
  "errors": []
}
```

## Acceptance Tests

- `AT-RUNLOOP-PROOF-001`: exits 0 with `--json` and `result === "pass"`
- `AT-RUNLOOP-PROOF-002`: `stop_reason === "completed"` and `turns_executed === 3`
- `AT-RUNLOOP-PROOF-003`: `roles === ["pm", "dev", "qa"]`
- `AT-RUNLOOP-PROOF-004`: `gates_approved === 2` (one phase transition, one completion)
- `AT-RUNLOOP-PROOF-005`: `rejection_count === 1` (dev rejected once, retried)
- `AT-RUNLOOP-PROOF-006`: `turn_history` contains one `accepted: false` entry for dev
- `AT-RUNLOOP-PROOF-007`: `event_types` includes `turn_assigned`, `turn_accepted`, `turn_rejected`, `gate_paused`, `gate_approved`, `completed`
- `AT-RUNLOOP-PROOF-008`: proof script does not import primitive lifecycle operations (`initRun`, `assignTurn`, `acceptTurn`, `rejectTurn`, `writeDispatchBundle`, `getTurnStagingResultPath`, `approvePhaseGate`, `approveCompletionGate`)
- `AT-RUNLOOP-PROOF-009`: proof script imports `runLoop` from `run-loop.js`
- `AT-RUNLOOP-PROOF-010`: proof script does not use `child_process`, `exec`, `spawn`
- `AT-RUNLOOP-PROOF-011`: prepublish gate runs the local contract test that executes the run-loop proof
- `AT-RUNLOOP-PROOF-012`: exits 0 in text mode and output includes "PASS"

## Error Cases

- If `runLoop` returns `ok: false`, the proof exits 1 with errors in the report.
- If scaffolding fails, the proof exits 1 with the error message.

## Open Questions

None. This is a composition proof, not a new feature.
