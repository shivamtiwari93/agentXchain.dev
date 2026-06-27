# PM Signoff — BUG-FIX: Step Auto-Checkpoint Acceptance — PM→Dev Handoff

Approved: YES

**Run:** `run_71c0a7eaf361090b`
**Phase:** planning
**Turn:** `turn_84a187d10ffbe060`
**Date:** 2026-06-26

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators using `agentxchain step` for manual turn-by-turn execution. Before the auto-checkpoint fix (run_8aceec319cd6aaed), operators had to manually run `git add && git commit` between consecutive `step` calls. The PM turn would leave planning artifacts dirty in the workspace, and the subsequent dev turn would fail with a "baseline not clean" error.

### Core Pain Point

ROADMAP.md line 70 has an unchecked acceptance criterion: "PM→Dev handoff via consecutive `step` calls succeeds without manual git commit." The underlying bug-fix work is **already delivered** — `checkpointAcceptedTurn()` was wired into `step.js` (lines 1007-1020), the `--no-checkpoint` flag was added (agentxchain.js:752), and three integration tests were written (AT-STEP-CKPT-001, -002, -003). What remains is **formal verification and roadmap closure**.

### Challenge to Previous Turn

#### OBJ-PM-001: All planning artifacts reference stale run (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md referenced `run_8498f2fd2d6c091d` (M4: Turn-Level Cost Tracking). The current run is `run_71c0a7eaf361090b` targeting a different M4 sub-item: step auto-checkpoint acceptance. All three artifacts rewritten from scratch.

### Core Workflow

1. **PM (this turn)** — Rewrite planning artifacts for this run's scope, define dev verification charter, scope acceptance
2. **Dev** — Run `step-auto-checkpoint.test.js` to confirm all 3 tests pass (AT-STEP-CKPT-001, -002, -003), check off ROADMAP.md:70
3. **QA** — Verify test evidence, confirm acceptance criterion is satisfied, ship verdict

### MVP Scope

**Verification-only.** No new code. The bug-fix was delivered in run_8aceec319cd6aaed:

| # | Deliverable | Location | Status |
|---|-------------|----------|--------|
| 1 | `checkpointAcceptedTurn()` wired into `step.js` after acceptance | `step.js:1007-1020` | Delivered |
| 2 | `--no-checkpoint` opt-out flag | `agentxchain.js:752`, `step.js:1008` | Delivered |
| 3 | AT-STEP-CKPT-001: PM accepted → auto-checkpoint → dev assigns cleanly | `step-auto-checkpoint.test.js` | Delivered |
| 4 | AT-STEP-CKPT-002: `--no-checkpoint` skips checkpoint | `step-auto-checkpoint.test.js` | Delivered |
| 5 | AT-STEP-CKPT-003: checkpoint failure exits non-zero, acceptance is durable | `step-auto-checkpoint.test.js` | Delivered |

**How auto-checkpoint solves the PM→Dev handoff:**

1. `step --role pm` dispatches PM turn → PM writes `.planning/` artifacts → turn accepted
2. After acceptance, `checkpointAcceptedTurn()` runs automatically:
   - Stages only files declared in `files_changed`
   - Creates git commit: `checkpoint: <turn_id> (role=pm, phase=planning, runtime=...)`
   - Updates `state.json` with `accepted_integration_ref: git:<sha>`
3. `step --role dev` sees clean baseline → assigns dev turn without error
4. **No manual `git add && git commit` needed between steps**

### Out of Scope

- New test coverage for negative cases (verifying next-turn rejection when checkpoint is skipped/fails) — useful but not required for this acceptance criterion
- Changes to `checkpointAcceptedTurn()` logic — already working
- Changes to `run.js` auto-checkpoint — already has this behavior; `step.js` now matches it
- Any code changes — verification-only run

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | `step-auto-checkpoint.test.js` passes all 3 tests (AT-STEP-CKPT-001, -002, -003) | Dev test output |
| 2 | AT-STEP-CKPT-001 specifically proves PM→Dev handoff without manual git commit | Dev evidence |
| 3 | ROADMAP.md:70 acceptance item checked off | Dev marks it |
| 4 | Acceptance contract satisfied: "PM→Dev handoff via consecutive `step` calls succeeds without manual git commit" | QA ship verdict |

### Design Decisions

#### DEC-001: Planning artifacts from run_8498f2fd2d6c091d (M4 cost tracking) rewritten for run_71c0a7eaf361090b (step auto-checkpoint acceptance)

The vision scanner triggered this run for ROADMAP.md:70 under the "BUG-FIX: Step Command Missing Auto-Checkpoint After Acceptance" section. The bug-fix code is complete; this run verifies and formally closes the acceptance criterion.

#### DEC-002: Acceptance is verification-only — AT-STEP-CKPT-001 directly demonstrates the PM→Dev handoff

AT-STEP-CKPT-001 runs the exact flow: PM turn accepted → auto-checkpoint creates git commit → dev turn assigns without dirty-workspace error. This test IS the acceptance evidence. No additional code or tests needed.

#### DEC-003: Dev charter is test-run + roadmap-check — no new code expected

All mechanism code was delivered in run_8aceec319cd6aaed. Dev confirms the test suite passes on the current codebase, then checks off ROADMAP.md:70.

## Notes for Dev

**Verification-only charter.** No new code changes expected.

Run the step auto-checkpoint test suite:
```bash
cd cli && npx vitest run test/step-auto-checkpoint.test.js
```

Confirm 3 tests pass with 0 failures:
- AT-STEP-CKPT-001: PM turn accepted → auto-checkpoint → dev turn assigns without dirty-workspace error
- AT-STEP-CKPT-002: `--no-checkpoint` skips auto-checkpoint
- AT-STEP-CKPT-003: checkpoint failure exits non-zero with retry command

Then check off ROADMAP.md:70:
```markdown
- [x] Acceptance: PM→Dev handoff via consecutive `step` calls succeeds without manual git commit
```

## Notes for QA

- Verify all 3 tests pass (0 failures)
- Confirm AT-STEP-CKPT-001 directly tests the acceptance criterion (PM→Dev handoff without manual git commit)
- Confirm ROADMAP.md:70 is checked off
- Ship verdict YES if tests pass and acceptance criterion is satisfied

## Acceptance Contract

1. **Roadmap milestone addressed: M4: Recovery & Resilience Hardening** — The "BUG-FIX: Step Command Missing Auto-Checkpoint After Acceptance" section (ROADMAP.md:66-70) is a sub-item under M4's recovery and resilience scope. Auto-checkpoint ensures step-driven workflows don't break on PM→Dev handoffs due to dirty workspace state.
2. **Unchecked roadmap item completed: PM→Dev handoff via consecutive `step` calls succeeds without manual git commit** — AT-STEP-CKPT-001 directly proves this: PM accepted → auto-checkpoint → dev assigns cleanly. Dev will check off ROADMAP.md:70 after test verification.
3. **Evidence source: .planning/ROADMAP.md:70** — Line 70 contains the unchecked acceptance criterion that this run closes.
