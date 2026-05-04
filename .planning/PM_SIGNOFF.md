# PM Signoff — M5: Protocol V8 — Parallel Turn Support

Approved: YES

**Run:** `run_b7c5380413abfbfb`
**Phase:** planning
**Turn:** `turn_e7579dd94a0e64a4`
**Date:** 2026-05-03

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running governed multi-agent workflows where multiple roles (e.g., two devs) can produce work concurrently within the same phase, reducing wall-clock time for implementation and QA.

### Core Pain Point

ROADMAP.md M5 lists 5 unchecked items for parallel turn support, yet the implementation is **already complete**. The protocol v7 codebase has:
- `active_turns` state model replacing `current_turn` (schema v1.1)
- `executeParallelTurns()` run-loop dispatch with configurable `max_concurrent_turns`
- Acceptance-time file-level conflict detection with `reject_and_reassign` and `human_merge` paths
- Per-turn dispatch bundle isolation (`.agentxchain/dispatch/turns/<turn_id>/`)
- Governance reports rendering `concurrent_with` and `sibling_attributed_files`
- 29 passing tests across 7 dedicated parallel test files

The pain point is that ROADMAP.md does not reflect this shipped state. This run's purpose is to reconcile documentation with implementation.

### Evidence of Completion

| ROADMAP Item | Evidence |
|---|---|
| Parallel turn dispatch within a single phase | `run-loop.js:251` `executeParallelTurns()` fills concurrency slots via `Promise.allSettled()`; `governed-state.js:3540-3555` enforces `max_concurrent_turns` per phase; config capped at 4 (`normalized-config.js:1494`) |
| Conflict detection when parallel turns modify overlapping files | `governed-state.js:4984-5025` checks file overlap against turns accepted after assignment; transitions conflicting turn to `conflicted` status with `conflict_state` |
| Merge strategy for parallel turn results | Two recovery paths: Path A `reject_and_reassign` (`governed-state.js:6467-6482`) rebases and retries; Path B `human_merge` (`governed-state.js:4179-4201`) defers to operator. Spec: `PARALLEL_CONFLICT_RECOVERY_SPEC.md` |
| Governance reports show parallel execution timelines | `report.js:459-461` renders `concurrent_with` and `sibling_attributed_files` per history entry; text/markdown/HTML all render sibling attribution notes (lines 1435, 1817, 2053, 2432, 2797) |
| 2 dev turns dispatched in parallel, both accepted, conflicts detected and resolved | `e2e-parallel-lifecycle.test.js:166-200` exercises: assign dev_a + dev_b → accept first → conflict second → reject_and_reassign → accept rebased retry |

### Test Evidence

```
7 parallel test files, 29 tests, 0 failures:
- e2e-parallel-lifecycle.test.js
- e2e-parallel-cli.test.js
- run-loop-parallel.test.js
- run-loop-conflict.test.js
- parallel-attribution-observability.test.js
- parallel-dispatch-progress-e2e.test.js
- e2e-parallel-approval-policy-lifecycle.test.js
```

### Core Workflow (this run)

1. **PM (this turn)** — Verify M5 is fully implemented, check off ROADMAP items, rewrite planning artifacts
2. **Dev** — Verify ROADMAP check-offs are accurate by confirming cited line numbers and test evidence
3. **QA** — Run full test suite to confirm no regressions, verify acceptance contract

### MVP Scope (this run)

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Verification-only signoff documenting M5 completion evidence
2. SYSTEM_SPEC.md: Technical reference to the 8 frozen parallel specs + implementation inventory
3. ROADMAP.md: M5 items checked off with evidence annotations

**Dev deliverables:**
- Verify each cited line number and test reference is accurate
- Produce evidence document confirming or correcting PM's citations
- No code changes expected (implementation already shipped)

### Out of Scope

- New code changes (M5 is already implemented)
- Changes to parallel turn state model (stable at schema v1.1)
- Changes to conflict detection or recovery (tested and stable)
- Changes to run-loop parallel dispatch (tested and stable)
- M6+ features (dashboard live observer, connectors, etc.)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Roadmap milestone addressed: M5: Protocol V8 — Parallel Turn Support | All 5 ROADMAP.md M5 items checked off with evidence |
| 2 | Unchecked roadmap item completed: Implement parallel turn dispatch within a single phase | `executeParallelTurns()` + `max_concurrent_turns` config + 29 passing tests |
| 3 | Evidence source: .planning/ROADMAP.md:73 | ROADMAP.md updated with check marks and evidence annotations |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cited line numbers may have shifted since implementation | Low | Dev charter requires line-by-line verification |
| Test count may have changed since snapshot | Low | QA runs full suite to confirm |

## Challenge to Previous Turn

### OBJ-PM-001: Previous planning artifacts describe step auto-checkpoint bug fix, not M5 (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all describe the step auto-checkpoint bug fix from `run_8aceec319cd6aaed`. This run's intent is M5: Protocol V8 — Parallel Turn Support. All three artifacts rewritten from scratch.

### OBJ-PM-002: Dev's last turn (turn_1eee6ec5c223b4ba) added checkpoint failure path test — unrelated to M5 (severity: medium)

The dev's AT-STEP-CKPT-003 test covers the auto-checkpoint failure path at `step.js:1010-1016`. This is residual work from the previous run's intent. It does not advance M5. The dev's decision DEC-001 ("PM's fast-track no-op claim is invalid") was correct for that run, but is irrelevant context for this M5 run.

## Notes for Dev

**Your charter is verification-only: confirm each M5 evidence citation is accurate. No code changes needed.**

1. Confirm `run-loop.js:251` contains `executeParallelTurns()` with `Promise.allSettled()` dispatch
2. Confirm `governed-state.js:3540-3555` enforces `max_concurrent_turns` concurrency limit
3. Confirm `governed-state.js:4984-5025` performs acceptance-time file overlap conflict detection
4. Confirm `governed-state.js:6467-6482` implements `reject_and_reassign` recovery path
5. Confirm `governed-state.js:4179-4201` implements `human_merge` recovery path
6. Confirm `report.js:459-461` renders `concurrent_with` and `sibling_attributed_files`
7. Run the 7 parallel test files and confirm all 29 tests pass
8. If any citation is inaccurate, document the correction — do NOT change code

## Notes for QA

- Run full test suite: `cd cli && npm test`
- Verify all 7 parallel test files pass
- Confirm ROADMAP.md M5 items are checked off with accurate evidence
- After ship: verify acceptance contract items from intake intent

## Acceptance Contract

1. **Roadmap milestone addressed: M5: Protocol V8 — Parallel Turn Support** — all 5 unchecked items checked off with implementation evidence
2. **Unchecked roadmap item completed: Implement parallel turn dispatch within a single phase (multiple devs working concurrently)** — `executeParallelTurns()` dispatches concurrent turns via `Promise.allSettled()`, configurable via `max_concurrent_turns` (1-4 per phase)
3. **Evidence source: .planning/ROADMAP.md:73** — ROADMAP.md updated to reflect checked-off M5 items
