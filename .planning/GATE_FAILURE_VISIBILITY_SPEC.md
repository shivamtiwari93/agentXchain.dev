# Gate Failure Visibility — Spec

> Preserve operator-usable context when a governed gate fails, especially when a queued request is evaluated at drain time.

---

## Purpose

Today a queued phase transition or run-completion request can fail at drain time and the state machine simply clears the queue. The run stays in the same phase, but the operator loses the request context and the exact failure reasons unless they reconstruct it from staging artifacts or rerun the scenario.

This spec makes gate failure a durable surface:

- persist the most recent governed gate failure in `state.json`
- record each failure in `decision-ledger.jsonl`
- expose the failure in `status` and `report`

The goal is not to auto-recover. The goal is to stop losing the diagnostic truth.

---

## Interface

### `state.json`

Add a nullable field:

```ts
interface LastGateFailure {
  gate_type: "phase_transition" | "run_completion";
  gate_id: string | null;
  phase: string;
  from_phase: string | null;
  to_phase: string | null;
  requested_by_turn: string | null;
  failed_at: string;
  queued_request: boolean;
  reasons: string[];
  missing_files: string[];
  missing_verification: boolean;
}
```

```ts
interface GovernedRunState {
  // existing fields...
  last_gate_failure?: LastGateFailure | null;
}
```

### `decision-ledger.jsonl`

Append a `type: "gate_failure"` entry every time a governed gate evaluates to `gate_failed`.

Required fields:

- `type`
- `gate_type`
- `gate_id`
- `phase`
- `from_phase`
- `to_phase`
- `requested_by_turn`
- `failed_at`
- `queued_request`
- `reasons`
- `missing_files`
- `missing_verification`

### `status`

Human-readable `agentxchain status` must show a dedicated gate-failure section when `state.last_gate_failure` is present:

- gate type
- gate id
- requested transition/completion context
- whether the failure came from a queued drain request
- failure reasons
- suggested next action: assign another turn in the same phase

`status --json` already returns raw state, so the new field only needs to be preserved.

### `report`

Governance report JSON must include `run.gate_failures`, sourced from `decision-ledger.jsonl`.

Human-readable and markdown report renders must include a `Gate Failures` section when present.

---

## Behavior

1. When `evaluatePhaseExit(...)` returns `gate_failed`:
   - set `phase_gate_status[gate_id] = "failed"` when `gate_id` exists
   - set `state.last_gate_failure` from the gate result
   - append a `gate_failure` decision-ledger entry
   - clear `queued_phase_transition`

2. When `evaluateRunCompletion(...)` returns `gate_failed`:
   - set `phase_gate_status[gate_id] = "failed"` when `gate_id` exists
   - set `state.last_gate_failure`
   - append a `gate_failure` decision-ledger entry
   - clear `queued_run_completion`

3. `last_gate_failure` remains until one of these happens:
   - a later gate passes and advances/completes
   - a later gate pauses for human approval
   - a later gate failure replaces it

4. A gate failure does **not** pause or block the run by itself.
   The run remains active in the same phase. Operators are expected to assign another turn that fixes the failed gate requirements.

5. This surface applies to both direct requests and queued drain requests.
   The `queued_request` flag tells operators which path produced the failure.

---

## Error Cases

- `gate_id` may be `null` when routing is invalid or open-gate behavior applies; persistence must still work.
- Multiple failures in sequence are allowed; `state.last_gate_failure` stores only the newest one, while `decision-ledger.jsonl` preserves the full sequence.
- Historical states without `last_gate_failure` remain valid and normalize to `null`.

---

## Acceptance Tests

1. **AT-GFV-001**: queued phase transition that fails gate checks at drain clears the queue but persists `state.last_gate_failure` with `queued_request: true`.
2. **AT-GFV-002**: queued run completion that fails gate checks at drain persists `state.last_gate_failure` and marks the gate `failed`.
3. **AT-GFV-003**: each governed gate failure appends a `type: "gate_failure"` ledger entry with reasons and request context.
4. **AT-GFV-004**: human-readable `agentxchain status` shows the persisted gate failure and the queued-drain note.
5. **AT-GFV-005**: `agentxchain report --format json` exposes `run.gate_failures`.
6. **AT-GFV-006**: a later successful gate clears `state.last_gate_failure`.

---

## Open Questions

- None for this slice. Runtime-specific failure-path proof can build on this surface later, but the operator-context loss needs to be fixed first.
