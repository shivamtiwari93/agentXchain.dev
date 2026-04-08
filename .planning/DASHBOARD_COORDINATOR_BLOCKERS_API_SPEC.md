# Dashboard Coordinator Blockers API Spec

## Purpose

Expose the coordinator's current gate-readiness and blocker state as a first-class dashboard bridge API so operators do not need to reconstruct it from raw `.agentxchain/multirepo/*` files.

This closes the remaining operator-surface gap after `repo_run_id_mismatch` was added to CLI and governance reports. The dashboard bridge must be able to answer:

- what gate is currently relevant
- whether that gate is ready
- which blockers are preventing forward progress
- whether the coordinator is already waiting on a pending gate instead of being blocked by prerequisites

## Interface

### Endpoint

- `GET /api/coordinator/blockers`

### Success Response

`200 OK`

```json
{
  "mode": "phase_transition",
  "super_run_id": "srun_123",
  "status": "active",
  "phase": "implementation",
  "blocked_reason": null,
  "pending_gate": null,
  "active": {
    "gate_type": "phase_transition",
    "gate_id": "phase_transition:implementation->qa",
    "ready": false,
    "current_phase": "implementation",
    "target_phase": "qa",
    "required_repos": ["api", "web"],
    "human_barriers": [],
    "blockers": [
      {
        "code": "repo_run_id_mismatch",
        "repo_id": "api",
        "expected_run_id": "run_api_001",
        "actual_run_id": "run_api_999",
        "message": "Repo \"api\" run identity drifted: coordinator expects \"run_api_001\" but repo has \"run_api_999\""
      }
    ]
  },
  "evaluations": {
    "phase_transition": {
      "ready": false,
      "gate_id": "phase_transition:implementation->qa",
      "current_phase": "implementation",
      "target_phase": "qa",
      "required_repos": ["api", "web"],
      "human_barriers": [],
      "blockers": []
    },
    "run_completion": {
      "ready": false,
      "gate_id": "initiative_ship",
      "required_repos": ["api", "web"],
      "human_barriers": [],
      "blockers": []
    }
  }
}
```

### Modes

- `pending_gate`: coordinator already has `state.pending_gate`; the dashboard should show approval state, not prerequisite blockers
- `phase_transition`: the next relevant gate is advancing to the next phase
- `run_completion`: the current phase is final, so initiative completion is the relevant gate

### Error Responses

- `404` with `code: "coordinator_state_missing"` when coordinator state does not exist
- `422` with `code: "coordinator_config_invalid"` when `agentxchain-multi.json` is present but invalid

## Behavior

- The endpoint must derive gate readiness from the same coordinator gate evaluators used by `multi step` and `multi approve-gate`.
- It must not invent new blocker semantics or silently normalize child repo drift.
- `mode` selection rules:
  - if `state.pending_gate` exists, respond with `mode: "pending_gate"` and expose the pending gate in `active`
  - otherwise evaluate phase transition readiness first
  - if the only phase blocker is `no_next_phase`, switch `active` to completion readiness
  - otherwise keep `active` on phase transition readiness
- The full `phase_transition` and `run_completion` evaluations must both be returned so future dashboard panels can show deeper diagnostics without reimplementing gate logic.
- `repo_run_id_mismatch` blockers must include `expected_run_id` and `actual_run_id`.

## Error Cases

- Missing coordinator config or state: do not return a fake empty blocker set
- Invalid config: surface validation errors instead of pretending the coordinator is healthy
- Missing child repo state: preserve `repo_state_missing` blockers from the gate evaluators
- Final phase: do not surface `no_next_phase` as the active blocker; switch to completion mode instead

## Acceptance Tests

- `GET /api/coordinator/blockers` returns `mode: "phase_transition"` and exposes `repo_run_id_mismatch` with expected vs actual run IDs when a child repo run drifts
- `GET /api/coordinator/blockers` returns `mode: "pending_gate"` with `ready: true` and no blockers when the coordinator already has a pending gate
- `GET /api/coordinator/blockers` returns `404` when no coordinator state exists
- Dashboard CLI docs mention the new endpoint and explain that it exposes structured coordinator blockers including run identity drift

## Open Questions

- Whether the dashboard SPA should add a dedicated blocker panel now or in a follow-up turn. This spec only defines the API contract needed for that work.
