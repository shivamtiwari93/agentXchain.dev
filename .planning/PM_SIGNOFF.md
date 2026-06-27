# PM Signoff — M14: Shippability Visibility — Vision Closure (VISION.md:50)

Approved: YES

**Run:** `run_a20d13cf8703032f`
**Phase:** planning
**Turn:** `turn_98ed2a7c83a53e47`
**Date:** 2026-06-26

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators managing governed runs across single and multi-repo configurations. VISION.md line 50 identifies a core coordination failure: "nobody knows what is actually shippable." The system has individual pieces — QA ship verdicts, release alignment checks, gate evaluations, governance reports — but no unified view that composes them into a single answer. Operators must manually inspect multiple artifacts to determine release readiness.

### Core Pain Point

The shippability question — "is this ready to ship?" — currently requires operators to:
1. Check run completion status (`governed-state.js` evaluateRunCompletion)
2. Inspect QA ship verdict artifacts manually
3. Review gate clearance across phases
4. Run release alignment validation separately
5. Cross-reference test verification evidence

No single command, module, or report section composes these into an actionable answer. For coordinator runs spanning multiple repos, the problem compounds — there's no aggregate view of per-repo shippability.

### Challenge to Previous Turn

#### OBJ-PM-001: All planning artifacts reference stale run (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all reference `run_4793c2273d675dd9` (M13: Decision Trail Ownership). The current run `run_a20d13cf8703032f` targets M14: Shippability Visibility — a new milestone requiring new code, not a verification-only run. All three artifacts rewritten from scratch. This is the 9th consecutive occurrence of stale planning artifacts needing rewrite at run start.

### Core Workflow

1. **PM (this turn)** — Derive M14 from VISION.md:50, add unchecked items to ROADMAP.md, rewrite planning artifacts
2. **Dev** — Build `ship-status.js` module, `ship-status` CLI command, coordinator aggregation, report integration, regression tests
3. **QA** — Verify 5 evidence dimensions compose correctly, test coverage, ship verdict

### MVP Scope

**Build milestone.** New module and CLI command required.

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | `ship-status.js` module | `evaluateShipStatus()` composing 5 evidence dimensions into ShipStatusReport |
| 2 | `ship-status` CLI command | `agentxchain ship-status` with `--json` and `--verbose` flags |
| 3 | Coordinator aggregation | `evaluateCoordinatorShipStatus()` for multi-repo ship readiness |
| 4 | Report integration | Ship-status summary in `buildGovernanceReport()` output |
| 5 | Regression tests | All-clear, gate-blocked, qa-pending, release-misaligned, coordinator mixed-state |

**5 evidence dimensions composed by `evaluateShipStatus()`:**

| # | Dimension | Source | Answers |
|---|-----------|--------|---------|
| 1 | Run completion status | `governed-state.js` run status + phase | "Has the run reached completion?" |
| 2 | QA ship verdict | workflow-gate-semantics ship_verdict evaluation | "Did QA approve shipping?" |
| 3 | Gate clearance | `gate-evaluator.js` all phase gates | "Are all governance gates satisfied?" |
| 4 | Release alignment | `release-alignment.js` dimension checks | "Are release artifacts aligned?" |
| 5 | Test verification | Turn verification evidence across phases | "Did tests pass?" |

### Out of Scope

- Changes to existing modules (release-alignment.js, gate-evaluator.js, etc.) — compose, don't rewrite
- Automated shipping/deployment triggers — visibility only, not automation
- UI/dashboard rendering of ship status — CLI and report integration only for M14
- Historical shippability tracking across past runs — current-state assessment only

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | `ship-status.js` module with `evaluateShipStatus()` composing 5 dimensions | Dev implementation |
| 2 | `agentxchain ship-status` CLI command functional with `--json` and `--verbose` | Dev demo |
| 3 | Coordinator-level aggregation working for multi-repo runs | Dev test |
| 4 | Governance report includes ship-status section | Dev integration |
| 5 | Regression tests pass for all scenarios | Dev test output |
| 6 | Vision closure: VISION.md:50 "nobody knows what is actually shippable" addressed | QA ship verdict |

### Design Decisions

#### DEC-001: Planning artifacts from run_4793c2273d675dd9 (Decision Trail Ownership) rewritten for run_a20d13cf8703032f scoped as M14 Shippability Visibility vision closure

The vision scanner triggered this run for roadmap replenishment — all milestones through M13 are checked. M14 targets VISION.md:50 "nobody knows what is actually shippable" as the next unclosed problem from the "Why This Must Exist" section, continuing the M11→:47, M12→:48, M13→:49, M14→:50 sequence.

#### DEC-002: M14 is a build milestone — new ship-status module composes 5 existing evidence dimensions

Unlike M11-M13 (verification-only milestones that confirmed existing mechanisms compose), M14 requires building a new composition layer. The individual dimensions (run status, ship verdict, gates, release alignment, tests) exist but aren't unified into a single assessment. The new `ship-status.js` module provides that composition.

#### DEC-003: Ship-status is visibility-only — no automated deploy/release triggers

M14 answers "is this ready to ship?" but does not act on the answer. Automation (auto-release, auto-deploy) would be a future milestone. Keeping M14 focused on visibility makes it bounded and testable.

## Notes for Dev

**Build charter.** New module and CLI command required.

1. Create `cli/src/lib/ship-status.js` with:
   - `evaluateShipStatus(repoDir)` → `ShipStatusReport` (overall: pass/fail/pending, dimensions[], blocking_reasons[])
   - `evaluateCoordinatorShipStatus(coordinatorDir)` → aggregate across repos
   - Each dimension: { name, status: pass/fail/pending, detail, blocking_reason? }

2. Create `cli/src/commands/ship-status.js` — register as `agentxchain ship-status`
   - `--json` for machine-readable output
   - `--verbose` for per-dimension detail
   - Default: summary line ("Shippable: YES/NO — N dimensions pass, M blocking")

3. Integrate into `report.js` `buildGovernanceReport()` — add `ship_status` field to report object

4. Create `cli/test/ship-status.test.js` with scenarios:
   - All 5 dimensions pass → overall: pass
   - Run not completed → overall: fail, blocking_reason
   - QA ship verdict missing → overall: pending
   - Gate not satisfied → overall: fail, blocking_reason
   - Release alignment failed → overall: fail, blocking_reason
   - Coordinator: 3 repos, mixed states → aggregate assessment

## Notes for QA

- Run all ship-status tests and confirm 0 failures
- Verify each of the 5 evidence dimensions produces meaningful pass/fail/pending status
- Confirm `agentxchain ship-status` CLI works with `--json` and `--verbose`
- Verify coordinator aggregation produces per-repo breakdown
- Confirm governance report includes ship-status section
- Vision closure: VISION.md:50 "nobody knows what is actually shippable" addressed by the composition of 5 evidence dimensions into a single queryable assessment

## Acceptance Contract

1. **Roadmap milestone addressed: M14: Shippability Visibility — Vision Closure (VISION.md:50)** — M14 closes the VISION.md problem "nobody knows what is actually shippable" by composing 5 evidence dimensions into a single shippability assessment.
2. **Unchecked roadmap items added: 6 items for M14** — module, CLI command, coordinator aggregation, report integration, tests, acceptance criterion.
3. **Evidence source: VISION.md:50** — Line 50 of "Why This Must Exist" section: "nobody knows what is actually shippable."
