# System Spec — M14: Shippability Visibility — Vision Closure (VISION.md:50)

**Run:** `run_74d17633499b410b`
**Turn:** `turn_d04775557f54746f`
**Baseline:** git:603609d74 (HEAD of dogfood/2157-lights-out)
**Implementation status:** ALREADY BUILT and committed by prior run `run_322ba900566dddfe` (dev `turn_9ce54587bc5981c1`). This spec is carried forward unchanged for scope reference; see PM_SIGNOFF.md "Challenge to Previous Turn" for the duplicate-run finding.

## Purpose

This run delivers ROADMAP.md M14: "Shippability Visibility — Vision Closure (VISION.md:50)."

VISION.md line 50 identifies a core coordination failure when multiple agents touch the same codebase over time: "nobody knows what is actually shippable." Individual mechanisms exist — run completion evaluation, QA ship verdicts, gate clearance, release alignment, test verification — but no unified view composes them into a single operator-queryable assessment. Operators must manually inspect multiple artifacts and mentally aggregate to determine if the codebase is ready to ship.

M14 addresses this by building a new composition layer (`ship-status.js`) that evaluates 5 evidence dimensions and exposes the result through a CLI command (`agentxchain ship-status`), coordinator aggregation, and governance report integration.

## Interface

### Module: `cli/src/lib/ship-status.js`

#### `evaluateShipStatus(repoDir: string): ShipStatusReport`

Composes 5 evidence dimensions into a single shippability assessment:

```javascript
// ShipStatusReport structure
{
  overall: 'pass' | 'fail' | 'pending',  // aggregate verdict
  dimensions: [
    {
      name: string,                        // dimension identifier
      status: 'pass' | 'fail' | 'pending',
      detail: string,                      // human-readable explanation
      blocking_reason: string | null       // why this dimension blocks shipping
    }
  ],
  blocking_reasons: string[],             // aggregated blocking reasons
  evidence_summary: string                // one-line summary
}
```

**Dimension 1: Run Completion Status**
- Source: `governed-state.js` `readState(root)` for status + phase; `gate-evaluator.js` `evaluateRunCompletion({ state, config, acceptedTurn, root })` for completion semantics (NOTE: the completion evaluator lives in `gate-evaluator.js`, not `governed-state.js`)
- Pass: run status is `completed`
- Pending: run is `running` or `needs_human`
- Fail: run is `failed` or `idle` without completion

**Dimension 2: QA Ship Verdict**
- Source: `workflow-gate-semantics.js` — call the EXPORTED `evaluateWorkflowGateSemantics(root, SHIP_VERDICT_PATH)` (both `evaluateWorkflowGateSemantics` and `SHIP_VERDICT_PATH = '.planning/ship-verdict.md'` are exported). NOTE: `evaluateShipVerdict` itself is module-internal and NOT exported — do not import it directly.
- Pass: QA ship verdict exists and says YES (`## Verdict: YES`)
- Pending: QA phase not yet reached
- Fail: QA ship verdict says NO or is missing after QA phase

**Dimension 3: Gate Clearance**
- Source: `gate-evaluator.js` — `evaluatePhaseExit({ state, config, acceptedTurn, root })` per phase and `evaluateRunCompletion(...)` for the terminal gate
- Pass: all defined gates are satisfied
- Pending: current phase gate not yet evaluated
- Fail: any gate failed

**Dimension 4: Release Alignment**
- Source: `release-alignment.js` `validateReleaseAlignment()`
- Pass: all required dimensions pass
- Pending: release alignment not yet evaluated (pre-release phase)
- Fail: any required dimension fails

**Dimension 5: Test Verification**
- Source: turn verification evidence (verification.status across accepted turns)
- Pass: all accepted turns have verification.status === 'pass'
- Pending: turns still in progress
- Fail: any accepted turn has verification.status === 'fail'

#### `evaluateCoordinatorShipStatus(coordinatorDir: string): CoordinatorShipStatusReport`

For multi-repo coordinator runs:

```javascript
{
  overall: 'pass' | 'fail' | 'pending',
  repos: [
    {
      repo_id: string,
      ship_status: ShipStatusReport        // per-repo assessment
    }
  ],
  blocking_repos: string[],               // repos that block overall shipping
  evidence_summary: string
}
```

### Command: `agentxchain ship-status`

**Registration:** `cli/bin/agentxchain.js`

```
agentxchain ship-status [options]

Options:
  --json      Machine-readable JSON output
  --verbose   Per-dimension detail breakdown
```

Default output:
```
Ship Status: YES (5/5 dimensions pass)
```
or
```
Ship Status: NO (3/5 dimensions pass, 2 blocking)
  - Gate clearance: FAIL — planning_signoff gate not satisfied
  - Release alignment: FAIL — changelog missing target version section
```

### Report Integration

`buildGovernanceReport()` in `report.js` includes:
```javascript
report.ship_status = {
  overall: 'pass' | 'fail' | 'pending',
  dimensions_passed: number,
  dimensions_total: number,
  blocking_reasons: string[]
}
```

### Architecture Invariants

1. `ship-status.js` composes existing modules — does not reimplement gate evaluation, release alignment, or verification logic
2. `evaluateShipStatus()` is read-only — never modifies run state, artifacts, or config
3. All 5 dimensions are independently evaluated — a failure in one does not skip evaluation of others
4. Coordinator aggregation uses worst-case semantics (any fail → overall fail, any pending → overall pending if no fail)
5. CLI command delegates entirely to the module — no business logic in the command file

## Acceptance Tests

### Test Suite: `cli/test/ship-status.test.js`

| # | Test ID | Scenario | Expected |
|---|---------|----------|----------|
| 1 | AT-SS-001 | All 5 dimensions pass | overall: pass, 0 blocking_reasons |
| 2 | AT-SS-002 | Run not completed (status: running) | overall: pending, blocking_reason cites run status |
| 3 | AT-SS-003 | Run failed | overall: fail, blocking_reason cites run failure |
| 4 | AT-SS-004 | QA ship verdict missing after QA phase | overall: fail, blocking_reason cites missing verdict |
| 5 | AT-SS-005 | QA ship verdict says NO | overall: fail, blocking_reason cites QA rejection |
| 6 | AT-SS-006 | Phase gate not satisfied | overall: fail, blocking_reason cites gate |
| 7 | AT-SS-007 | Release alignment dimension fails | overall: fail, blocking_reason cites alignment |
| 8 | AT-SS-008 | Turn verification failed | overall: fail, blocking_reason cites verification |
| 9 | AT-SS-009 | Coordinator: all repos pass | overall: pass |
| 10 | AT-SS-010 | Coordinator: mixed states (2 pass, 1 fail) | overall: fail, blocking_repos lists failing repo |
| 11 | AT-SS-011 | CLI --json output matches ShipStatusReport schema | JSON validated |
| 12 | AT-SS-012 | CLI --verbose shows per-dimension detail | Output contains all 5 dimension names |

### Acceptance Criteria

| # | Criterion | Evidence Required |
|---|-----------|-------------------|
| AC-1 | `ship-status.js` with `evaluateShipStatus()` composing 5 dimensions | Module exists, tests AT-SS-001 through AT-SS-008 pass |
| AC-2 | `agentxchain ship-status` CLI command with `--json` and `--verbose` | Tests AT-SS-011, AT-SS-012 pass |
| AC-3 | Coordinator aggregation via `evaluateCoordinatorShipStatus()` | Tests AT-SS-009, AT-SS-010 pass |
| AC-4 | Governance report includes ship-status summary | Report integration test passes |
| AC-5 | All 12 tests pass with 0 failures | Dev test output |
| AC-6 | Vision closure: VISION.md:50 addressed by 5-dimension composition | QA ship verdict |
