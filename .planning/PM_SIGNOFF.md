# PM Signoff — M1: Ghost Turn Elimination (Roadmap Reconciliation)

Approved: YES

**Run:** `run_936b36c729c01f54`
**Phase:** planning
**Turn:** `turn_a235a009bfe9fc9d`
**Date:** 2026-05-01

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

Same as prior run: agentXchain operators running governed multi-agent delivery via local_cli runtimes.

### Core Pain Point

The prior run (`run_984f0f8c07a30a5c`) implemented all M1 hardening items (startup heartbeat, pre-spawn guard, regression tests) and QA approved them, but failed to update ROADMAP.md to check off completed items. The vision scanner detected the unchecked item as open work and triggered this unnecessary run. The pain point is a **process gap**, not a missing implementation.

### Core Workflow

1. PM verifies the implementation exists and tests pass (this turn)
2. PM checks off completed ROADMAP items with evidence references
3. Dev verifies the full M1 regression suite still passes
4. QA confirms roadmap accuracy against code reality

### MVP Scope (this run)

- **PM (this turn):** Verify implementation, check off ROADMAP items, document evidence
- **Dev:** Run the full M1 regression test suite, confirm all hardening code is intact, verify no regressions since prior run
- **QA:** Cross-check ROADMAP checkoffs against actual implementation, confirm the remaining acceptance criterion (10 consecutive zero-ghost runs) is correctly left open

### Out of Scope

- New M1 implementation work (already done in prior run)
- M2-M8 roadmap items
- The 10-run acceptance criterion (tracked as open in ROADMAP.md, requires dogfood runs over time)
- DOGFOOD-100 (paused on credential blocker)
- Any code changes unless regressions are found

### Success Metric

ROADMAP.md M1 items accurately reflect implemented state. All 3 completed items checked with evidence. The remaining acceptance item correctly left open.

## Challenge to Previous Work

### OBJ-PM-001: Prior QA turn shipped without roadmap synchronization

The QA turn in `run_984f0f8c07a30a5c` (DEC-001/002/003) approved the M1 implementation and declared ship-ready, but did not verify or update ROADMAP.md to check off the completed items. This is a process gap: the QA checklist should include roadmap synchronization as a release gate. Without it, the vision scanner re-triggers runs for work that is already complete — wasting budget and cluttering history.

**Recommendation:** Future QA turns should include a "roadmap accuracy" check: all items addressed by the run should be checked off before ship approval.

### OBJ-PM-002: Configurable turn timeout was not a new implementation

The ROADMAP item "Add configurable turn timeout (distinct from startup watchdog)" implied new work, but `timeouts.per_turn_minutes` already existed as the configurable turn-level timeout. Dev correctly identified this and threaded dispatch timeout inputs rather than creating a redundant mechanism. Checking this off with a clarifying note.

## Notes for Dev

Your charter for this run is **verification, not implementation**:

1. Run the full adapter test suite: `node --test --test-timeout=60000 cli/test/local-cli-adapter.test.js`
2. Run the ghost-retry and continuous-run tests: `node --test --test-timeout=60000 cli/test/ghost-retry.test.js cli/test/continuous-run.test.js`
3. Run the schema validation tests: `node --test --test-timeout=60000 cli/test/agentxchain-config-schema.test.js`
4. Confirm all tests pass with zero failures
5. If any test fails, investigate and fix — but new regressions are unlikely given QA approval in the prior run

**Do NOT** write new code unless a regression is found. This is a reconciliation run.

## Notes for QA

- Cross-check each ROADMAP checkoff against the actual implementation files cited
- Verify the test references in the ROADMAP are accurate (file:line)
- Confirm the "Acceptance: zero ghost turns across 10 consecutive runs" item is correctly left unchecked
- Budget: this run should be lightweight — no new implementation, just verification and reconciliation
