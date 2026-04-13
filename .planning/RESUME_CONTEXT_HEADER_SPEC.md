# Resume Context Header Spec

## Purpose

`agentxchain resume` must print a run-context header before dispatch, matching the operator experience established by `run` (DEC-RUN-PROVENANCE-HEADER-001) and `step` (DEC-STEP-CONTEXT-HEADER-001).

Currently `resume` is provenance-blind and gate-blind — the operator sees only the turn assignment summary after dispatch. This makes it impossible to verify at a glance whether the run has provenance, inherited context, or an active exit gate without running `status` separately.

## Interface

Before any turn assignment or re-dispatch output, `resume` prints:

```
agentxchain resume
  Run:      <run_id>
  Phase:    <phase>
  Origin:   <provenance summary>          # only when non-manual provenance
  Inherits: parent <id> (<status>)        # only when inherited context exists
  Gate:     <gate_name> (<gate_status>)   # only when exit gate defined
  Files:    <file checks>                 # only when gate pending + requires_files
  Needs:    <requirements>                # only when gate pending + approval/verification
```

## Behavior

- Header prints once per `resume` invocation, before any "Re-dispatching..." or "Turn Assigned" output.
- Uses the same `summarizeRunProvenance()` function from `run-provenance.js`.
- Gate detail uses the same rendering logic as `step.js:printStepRunContext`.
- If the run has not been initialized yet (idle + no run_id), `Run:` shows `(uninitialized)`.

## Error Cases

- None — this is output-only. If state is corrupt, the existing error paths in `resume` handle it.

## Acceptance Tests

- AT-RCH-001: `resume` on a continuation run shows `Origin: continuation from <id>`.
- AT-RCH-002: `resume` on a run with inherited context shows `Inherits:`.
- AT-RCH-003: `resume` on a plain manual run does NOT show `Origin:` or `Inherits:`.
- AT-RCH-004: `resume` shows `Gate:` when the current phase has an exit gate.
