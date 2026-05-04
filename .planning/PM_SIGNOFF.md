# PM Signoff — M10: Cross-Run Scope Overlap Guard

Approved: YES

**Run:** `run_2e96850371ff1a1c`
**Phase:** planning
**Turn:** `turn_757534c324a0b0bb`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running continuous vision-driven mode, where `seedFromVision()` auto-derives and auto-approves intents between runs. The scope overlap guard prevents the continuous loop from spawning runs whose scope duplicates recently completed work.

### Core Pain Point

The vision scanner derives intent candidates from VISION.md goals using word-matching (`isGoalAddressed` at 0.6 threshold). Event-level deduplication uses exact signal hashes (`computeDedupKey`). Neither mechanism prevents semantically overlapping charters from spawning back-to-back runs that touch the same codebase areas.

**Concrete example:** M5 (Parallel Turn Support) fully addressed intra-run "work overlaps" via `classifyAcceptanceOverlap()`. But the vision scanner still flags "work overlaps" (VISION.md:30) as unaddressed because no completed intent signal contains both significant words. A new run spawns, potentially re-touching the same conflict detection modules that M5 just delivered.

This directly manifests as wasted budget ($5–15 per unnecessary run), history clutter, and the perception that the continuous loop is churning rather than converging.

### Challenge to Previous Turn

#### OBJ-PM-001: All planning artifacts reference stale run (severity: medium)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all reference `run_cf572ef2d54d357d` (MW: BUG-78 Formal Closure). The current run is `run_2e96850371ff1a1c`, derived from the vision scan identifying "work overlaps" as uncovered scope. All three artifacts rewritten from scratch.

#### OBJ-PM-002: Vision scanner correctly identified a real gap (severity: low)

The "work overlaps" vision goal (VISION.md:30) IS substantially addressed by M5's parallel conflict detection within runs. However, cross-run scope overlap — the continuous loop spawning runs with overlapping scope — is NOT addressed anywhere. This PM turn scopes M10 to close that specific gap rather than declaring the vision goal already covered.

### Core Workflow

1. **PM (this turn)** — Define M10 scope, spec insertion points, rewrite all planning artifacts
2. **Dev** — Implement `scope-overlap.js`, integrate into `approveIntent()` and `seedFromVision()`, write 10 tests
3. **QA** — Verify 10 acceptance tests pass, confirm no regressions in intake/continuous-run test suites

### MVP Scope

**New module + two integration points + CLI flag.**

1. `cli/src/lib/scope-overlap.js` (new) — `extractScopeFingerprint()`, `computeScopeOverlap()`, `checkIntentScopeOverlap()`
2. `cli/src/lib/intake.js` (modify) — scope overlap guard in `approveIntent()` (after line 886 status check, before line 889)
3. `cli/src/lib/continuous-run.js` (modify) — handle `scope_overlap_detected` error at 3 auto-approval sites (lines 1324, 1399, 1482) by returning idle
4. `cli/src/commands/intake-approve.js` (modify) — pass `forceScope` option from `--force-scope` CLI flag
5. `cli/bin/agentxchain.js` (modify) — add `--force-scope` option to `intake approve` command (line 1041 area)
6. `cli/test/scope-overlap.test.js` (new) — 10 tests

### Out of Scope

- Cross-repo file overlap detection (multi-repo coordinator is workstream-level)
- Changes to `classifyAcceptanceOverlap()` or M5 parallel conflict infrastructure
- Changes to `computeDedupKey()` or event-level deduplication
- Changes to `isGoalAddressed()` word-matching in vision-reader.js
- Config schema additions (use code-level defaults; schema can be added later)
- Dashboard visibility of scope overlap events (future enhancement)
- Blocking behavior (overlap is advisory/deferring, not hard-blocking)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Vision goal addressed: work overlaps | M10 directly prevents cross-run scope overlap, the remaining uncovered aspect of "work overlaps" |
| 2 | `extractScopeFingerprint` extracts milestone refs and module keywords | AT-SOG-001, AT-SOG-002, AT-SOG-003 |
| 3 | `computeScopeOverlap` returns correct Jaccard coefficient | AT-SOG-004, AT-SOG-005, AT-SOG-006 |
| 4 | `checkIntentScopeOverlap` detects overlap with active and recent runs | AT-SOG-007, AT-SOG-008, AT-SOG-009 |
| 5 | `approveIntent` returns `scope_overlap_detected` when threshold exceeded | AT-SOG-010 |
| 6 | `--force-scope` flag bypasses the guard | AT-SOG-010 variant or manual verification |
| 7 | Continuous loop defers overlapping intents (returns idle) | Integration behavior confirmed by AT-SOG-010 + code review |
| 8 | No regressions in intake or continuous-run test suites | Regression suite pass |

### Design Decisions

#### DEC-001: Previous planning artifacts described BUG-78 (run_cf572ef2d54d357d) — all three rewritten from scratch for M10 (run_2e96850371ff1a1c)

The continuous loop opened a new run to address the "work overlaps" vision goal. M10 scoped as the next increment.

#### DEC-002: Scope overlap is advisory/deferring, not hard-blocking

When `approveIntent()` detects scope overlap, it returns an error that the continuous loop handles by deferring (returning idle). The operator can always override with `--force-scope`. This matches the existing advisory pattern (`advisory_scope_overlap` warnings at dispatch time in `dispatch-bundle.js:165`).

#### DEC-003: Jaccard similarity on extracted tokens is the right overlap measure for charter text

Charter text is short (1-2 sentences). Jaccard on significant extracted tokens (milestone refs, module keywords, file paths) is simple, deterministic, and sufficient. ML-based embeddings would be overkill and introduce model dependency.

#### DEC-004: Overlap check looks at recent completed intents + active run charter, not turn-level files_changed

Checking at the charter/intent level (not individual file paths) is correct because:
- The overlap decision should be made BEFORE the run starts (at approval time)
- File paths aren't known until after turns execute
- Charter text captures the semantic scope of the work

## Notes for Dev

**Three code deliverables:**

1. **New module** `cli/src/lib/scope-overlap.js` — See SYSTEM_SPEC.md for exact function signatures and behavior
2. **Intake integration** — `approveIntent()` in `cli/src/lib/intake.js` at line 886-889 — add scope overlap check
3. **Continuous loop integration** — `seedFromVision()` in `cli/src/lib/continuous-run.js` at lines 1324, 1399, 1482 — handle `scope_overlap_detected` by returning idle

**CLI addition:** `--force-scope` flag on `intake approve` (agentxchain.js:1041, intake-approve.js:18)

**Test file:** `cli/test/scope-overlap.test.js` with 10 tests (AT-SOG-001 through AT-SOG-010)

## Notes for QA

- Run `scope-overlap.test.js`: all 10 tests must pass
- Run `intake.test.js`: no regressions
- Run `continuous-run.test.js`: no regressions
- Verify `extractScopeFingerprint` correctly extracts M-prefixed milestones, BUG-prefixed refs, and module keywords
- Verify Jaccard coefficient math is correct (intersection / union)
- Verify `--force-scope` bypasses the guard in intake-approve.js
- Confirm no changes to governed-state.js, turn-result-validator.js, or any M5 parallel conflict code

## Acceptance Contract

1. **Vision goal addressed: work overlaps** — M10 closes the cross-run scope overlap gap. Intra-run overlap was already addressed by M5 (classifyAcceptanceOverlap). M10 prevents the continuous loop from spawning semantically overlapping runs by checking charter similarity at approval time.

## API Map

| Module | Status | Purpose |
|--------|--------|---------|
| `cli/src/lib/scope-overlap.js` | New | Scope fingerprint extraction, Jaccard overlap, intent overlap check |
| `cli/src/lib/intake.js` | Modified | `approveIntent()` scope overlap guard before approval |
| `cli/src/lib/continuous-run.js` | Modified | `seedFromVision()` handles overlap deferral at 3 auto-approval sites |
| `cli/src/commands/intake-approve.js` | Modified | `--force-scope` option passthrough |
| `cli/bin/agentxchain.js` | Modified | `--force-scope` CLI option on `intake approve` |
| `cli/test/scope-overlap.test.js` | New | 10 acceptance + regression tests |
