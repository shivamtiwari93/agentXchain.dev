# Mixed-Runtime Parallel Lights-Out Spec

> Prove that parallel governed turns with genuinely different runtime types complete lights-out through approval policy, and that the full evidence trail (attribution, conflict detection, approval-policy ledger, export, report) is truthful regardless of adapter type.

## Purpose

All existing parallel E2E tests use homogeneous runtimes (`manual` or `local_cli` for every role). This creates a blind spot: the protocol has never been proven to handle mixed-runtime parallel execution where one turn dispatches via `local_cli` (subprocess) and another via `api_proxy` (synchronous API call) in the same phase.

The governed state machine should be runtime-agnostic — turn assignment, staging, acceptance, conflict detection, attribution, approval policy, and reporting must not depend on which adapter fulfilled a turn. This spec defines the proof surface.

## Interface

### Config Shape

```json
{
  "roles": {
    "pm":         { "runtime": "manual-pm",    "write_authority": "review_only" },
    "dev":        { "runtime": "local-dev",     "write_authority": "authoritative" },
    "integrator": { "runtime": "proxy-integrator", "write_authority": "authoritative" },
    "qa":         { "runtime": "manual-qa",     "write_authority": "review_only" }
  },
  "runtimes": {
    "manual-pm":        { "type": "manual" },
    "local-dev":        { "type": "local_cli" },
    "proxy-integrator": { "type": "api_proxy", "provider": "anthropic", "model": "claude-sonnet-4-6" },
    "manual-qa":        { "type": "manual" }
  },
  "routing": {
    "implementation": { "max_concurrent_turns": 2 }
  },
  "approval_policy": {
    "phase_transitions": {
      "default": "require_human",
      "rules": [
        { "from_phase": "planning", "to_phase": "implementation", "action": "auto_approve", "when": { "gate_passed": true } },
        { "from_phase": "implementation", "to_phase": "qa", "action": "auto_approve", "when": { "gate_passed": true, "roles_participated": ["dev", "integrator"] } }
      ]
    },
    "run_completion": {
      "action": "auto_approve",
      "when": { "gate_passed": true, "all_phases_visited": true }
    }
  }
}
```

### Mixed-Runtime Invariant

The governed state machine must treat `local_cli` and `api_proxy` turns identically at every protocol boundary:

- **Assignment:** Both runtime types can be assigned concurrently within the same phase.
- **Staging:** Both produce `.agentxchain/staging/<turn_id>/turn-result.json` with the same schema.
- **Acceptance:** `acceptGovernedTurn` does not inspect `runtime.type`; it evaluates the staged result.
- **Attribution:** `concurrent_with` and `attributed_to_concurrent_siblings` are populated based on turn assignment sequence, not adapter type.
- **Conflict detection:** `buildConflictCandidateFiles` uses attributed observation plus declared overlap — adapter type is invisible.
- **Approval policy:** `evaluateApprovalPolicy` checks `roles_participated`, not runtime types.
- **Report/Export:** Timeline entries carry `runtime_id` for provenance but the report structure is runtime-agnostic.

## Behavior

### Phase Flow

1. **Planning (manual):** PM turn completes, requests transition to implementation. Approval policy auto-advances (`gate_passed: true`).
2. **Implementation (parallel, mixed-runtime):**
   - `dev` assigned via `local_cli` runtime
   - `integrator` assigned via `api_proxy` runtime
   - Both turns execute concurrently (`max_concurrent_turns: 2`)
   - `dev` accepted first with workspace files; `integrator` accepted second with review files
   - Attribution filters sibling files correctly
   - Approval policy auto-advances to QA once both `roles_participated: ["dev", "integrator"]`
3. **QA (manual):** QA turn completes, requests run completion. Approval policy auto-completes (`all_phases_visited: true`).

### Evidence Requirements

At the end of the governed run:

1. `state.status === 'completed'`
2. History has 4 entries: `[pm, dev, integrator, qa]` — each with correct `runtime_id`
3. Decision ledger has 3 `approval_policy` entries (planning advance, implementation advance, run completion)
4. The implementation-advance ledger entry has `matched_rule.when.roles_participated === ['dev', 'integrator']`
5. History entries for `dev` and `integrator` each have `concurrent_with` containing the other's `turn_id`
6. Export contains all governed artifacts with valid checksums
7. Report JSON preserves:
   - `approval_policy_events` (3 entries)
   - `turns` with correct `role` order and `concurrent_with` metadata
   - Mixed `runtime_id` values visible in the timeline

## Error Cases

1. If one parallel turn is accepted and the other conflicts, the conflicting turn should be rejectable and reassignable regardless of runtime type.
2. If the `api_proxy` turn stages an invalid result (missing required fields), acceptance must reject it the same way it would reject an invalid `local_cli` result.
3. If both parallel turns declare overlapping files, conflict detection must fire even if they use different adapters.

## Acceptance Tests

| ID | Assertion |
|----|-----------|
| AT-MRL-001 | Planning auto-advances via approval policy (1st ledger entry) |
| AT-MRL-002 | `dev` (local_cli) and `integrator` (api_proxy) are assigned concurrently with different `runtime_id` values |
| AT-MRL-003 | First parallel acceptance does not advance the phase; `queued_phase_transition` is set |
| AT-MRL-004 | Second parallel acceptance auto-advances to QA via approval policy (2nd ledger entry with `roles_participated`) |
| AT-MRL-005 | Later-assigned parallel turn's history entry carries `concurrent_with` referencing earlier turn |
| AT-MRL-006 | QA auto-completes the run via approval policy (3rd ledger entry with `all_phases_visited`) |
| AT-MRL-007 | Export artifact is valid and report preserves all 3 approval-policy events |
| AT-MRL-008 | Report timeline shows mixed `runtime_id` values across turns |
| AT-MRL-009 | History entries carry correct `runtime_id` matching the declared runtime type |

## Test Strategy

The E2E bypasses actual adapter dispatch (no live API calls, no subprocess spawn) by directly staging turn results — the same pattern used in `e2e-parallel-approval-policy-lifecycle.test.js`. This is correct because the proof target is the **governed state machine**, not the adapter transport. Adapter transport is proven separately in adapter-specific tests.

The mixed-runtime signal is:
- Different `type` values in `runtimes` config
- Different `runtime_id` values on assigned turns
- Different `runtime_id` values persisted in history and report

## Open Questions

None. The governed state machine is already runtime-agnostic by design. This spec proves it.
