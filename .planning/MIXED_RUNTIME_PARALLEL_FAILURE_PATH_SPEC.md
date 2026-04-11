# Mixed-Runtime Parallel Failure-Path Proof

## Purpose

Prove that when two parallel turns with different runtime types (local_cli + api_proxy) execute in the implementation phase and the queued phase-transition gate **fails** at drain time, the governed state machine:

1. Persists the gate failure durably in `state.json` as `last_gate_failure`
2. Appends a `type: "gate_failure"` entry to the decision ledger
3. Clears the queued phase transition without advancing
4. Does not block or lose the successful turn's acceptance
5. Surfaces the failure via `status --json` and `report --format json`
6. Allows recovery: a subsequent turn can fix the gate predicate and advance

## Invariant Under Test

The governed state machine is runtime-agnostic at every boundary (assignment, staging, acceptance, conflict detection, attribution, gate evaluation). A gate failure at drain time must produce the same durable context regardless of which runtime type triggered the drain.

## Scenario

1. **Planning**: PM completes, approval policy auto-advances to implementation
2. **Implementation**: Dev (local_cli) and integrator (api_proxy) assigned concurrently
3. **Dev accepted first**: writes a malformed `.planning/IMPLEMENTATION_NOTES.md` (missing `## Verification` section), requests `phase_transition_request: 'qa'` → transition **queued** because integrator is still active
4. **Integrator accepted second (drain)**: gate evaluates the queued transition → `gate_failed` because `IMPLEMENTATION_NOTES.md` fails semantic validation (`## Verification` section missing)
5. **State preserved**: `last_gate_failure` persisted with `queued_request: true`, `gate_type: 'phase_transition'`, and semantic failure reason
6. **Status surfaces failure**: `status --json` includes `last_gate_failure` object
7. **Report surfaces failure**: `report --format json` includes `gate_failures` array in `subject.run`
8. **Recovery**: A new dev turn writes valid implementation notes, requests phase transition → gate passes → phase advances to QA

## Gate Failure Shape (Expected)

```json
{
  "gate_type": "phase_transition",
  "gate_id": "implementation_complete",
  "phase": "implementation",
  "from_phase": "implementation",
  "to_phase": "qa",
  "requested_by_turn": "<dev_turn_id>",
  "failed_at": "<iso_timestamp>",
  "queued_request": true,
  "reasons": ["<semantic validation failure message>"],
  "missing_files": [],
  "missing_verification": false
}
```

## Acceptance Tests

| ID | Criterion | Pass Condition |
|----|-----------|----------------|
| AT-MRFP-001 | Planning auto-advances | `state.phase === 'implementation'` after PM turn |
| AT-MRFP-002 | Mixed-runtime parallel assignment | Dev (local-dev) and integrator (proxy-integrator) assigned with different `runtime_id` |
| AT-MRFP-003 | First acceptance queues transition | `state.queued_phase_transition.to === 'qa'` after dev accepted |
| AT-MRFP-004 | Drain-time gate failure persisted | `state.last_gate_failure.gate_type === 'phase_transition'` and `queued_request === true` |
| AT-MRFP-005 | Phase does not advance | `state.phase === 'implementation'` after integrator accepted |
| AT-MRFP-006 | Queued transition cleared | `state.queued_phase_transition === null` |
| AT-MRFP-007 | Gate failure ledger entry | Decision ledger contains `type: "gate_failure"` with correct context |
| AT-MRFP-008 | Status --json surfaces failure | JSON output includes `last_gate_failure` with expected shape |
| AT-MRFP-009 | Report surfaces gate failure digest | `report.subject.run.gate_failures` array is non-empty with correct entry |
| AT-MRFP-010 | Successful sibling acceptance preserved | Dev and integrator history entries both exist with correct `runtime_id` |
| AT-MRFP-011 | Recovery: new turn fixes gate and advances | After writing valid notes and accepting a recovery turn, `state.phase === 'qa'` |

## Open Questions

None — this is a pure proof test with no product-design ambiguity.
