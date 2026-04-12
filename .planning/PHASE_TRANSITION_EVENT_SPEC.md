# Phase Transition Event Observability Spec

## Purpose

Automatic phase transitions and gate failures are invisible in the event stream (`events.jsonl`). Operators monitoring governed runs via `agentxchain events` see `turn_accepted` but never see that a phase advanced or a gate failed unless they dig into `state.json` or `decision-ledger.jsonl`.

This spec closes that gap by emitting `phase_entered` events for all phase transitions (not just human-approved ones) and adding a new `gate_failed` event for gate failures.

## Problem (verified from code)

| Phase transition path | Event emitted? | Evidence |
|---|---|---|
| Direct gate pass (`action === 'advance'`) | **No** | governed-state.js:2855-2863 — state updates, no `emitRunEvent` |
| Auto-approved (`approvalResult.action === 'auto_approve'`) | **No** | governed-state.js:2873-2892 — ledger entry, no `emitRunEvent` |
| Human-approved (`approveTransition()`) | **Yes** | governed-state.js:3533-3544 — `gate_approved` + `phase_entered` |
| Gate failure (`action === 'gate_failed'`) | **No** | governed-state.js:2906-2928 — ledger entry, no `emitRunEvent` |

## Interface

### New event type: `gate_failed`

Added to `VALID_RUN_EVENTS` in `run-events.js`.

### Enriched `phase_entered` payload

All `phase_entered` events (automatic, auto-approved, and human-approved) carry:

```json
{
  "from": "planning",
  "to": "implementation",
  "gate_id": "planning_gate",
  "trigger": "auto" | "auto_approved" | "human_approved"
}
```

- `trigger: "auto"` — gate passed directly, no approval needed
- `trigger: "auto_approved"` — gate required approval but policy auto-approved
- `trigger: "human_approved"` — human ran `approve-transition`

### `gate_failed` payload

```json
{
  "gate_id": "planning_gate",
  "from_phase": "planning",
  "to_phase": "implementation",
  "reasons": ["Missing required file: SPEC.md"]
}
```

### `events` command text rendering

- `phase_entered` renders as: `phase_entered  [role] planning → implementation (auto)`
- `gate_failed` renders as: `gate_failed  planning → implementation — Missing required file (planning_gate)`

## Behavior

1. When `gateResult.action === 'advance'`: emit `phase_entered` with `trigger: "auto"` after state update, before subsequent event emissions.
2. When `approvalResult.action === 'auto_approve'`: emit `phase_entered` with `trigger: "auto_approved"` after state update and ledger entry.
3. When `gateResult.action === 'gate_failed'`: emit `gate_failed` with failure reasons from `gateResult`.
4. Existing human-approved path (`approveTransition`): enrich existing `phase_entered` payload with `to`, `gate_id`, and `trigger: "human_approved"`.
5. `events` command: add inline rendering for `phase_entered` (from → to + trigger) and `gate_failed` (from → to + first reason + gate_id).

## Error Cases

- Missing `gate_id`: use `'no_gate'` (consistent with existing phase_gate_status logic)
- Missing `from`/`to`: omit transition detail in text rendering
- Empty `reasons` array in gate failure: render without reason detail

## Acceptance Tests

1. Automatic phase advancement emits `phase_entered` event with `trigger: "auto"`, `from`, `to`, `gate_id`
2. Auto-approved phase advancement emits `phase_entered` event with `trigger: "auto_approved"`
3. Gate failure emits `gate_failed` event with `gate_id`, `from_phase`, `to_phase`, `reasons`
4. Human-approved `phase_entered` event includes enriched payload (`to`, `gate_id`, `trigger: "human_approved"`)
5. `events` text output shows `phase_entered` with inline `from → to (trigger)` detail
6. `events` text output shows `gate_failed` with inline reason and gate_id
7. Existing test suites pass without regression

## Open Questions

None — this is a data-layer enrichment of existing event infrastructure.
