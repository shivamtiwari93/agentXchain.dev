# PM Signoff — M2: Vision Derivation (Continuous Roadmap Replenishment Dispatch)

Approved: YES

**Run:** `run_b51cc53d95925d53`
**Phase:** planning
**Turn:** `turn_853295f1b3b14b5b`
**Date:** 2026-05-01

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running continuous vision-driven mode (`--continuous`) with local_cli runtimes.

### Core Pain Point

M2 items #2–#4 describe behavior that is **already implemented** (BUG-77) but not formally verified, documented, or checked off. The vision scanner keeps re-triggering this work because the items remain unchecked. The actual code gap is narrow: the status message doesn't match the M2 spec, and integration-level regression tests for the three-state model through `seedFromVision()` are missing.

**Evidence chain:**
- `seedFromVision()` in `continuous-run.js:1332-1403` already handles `roadmap_exhausted_vision_open` with PM dispatch, PM-preferred routing, and planning phase scope
- `detectRoadmapExhaustedVisionOpen()` in `vision-reader.js:461-569` already detects the three states including tracked items (fixed in `run_e9d2aeed559c018e`)
- BUG-77 integration test (`bug-77-roadmap-exhausted-vision-open.test.js`) validates end-to-end dispatch
- Vision-reader unit tests validate three-state detection with tracked items
- Status message at `continuous-run.js:2292` says "Roadmap-replenishment (roadmap exhausted, vision open)" but M2 item #3 requires "Roadmap exhausted, vision still open, deriving next increment"

### Core Workflow

1. PM diagnoses M2 item #2 as already implemented, scopes remaining gaps (this turn)
2. Dev verifies existing mechanism, updates status message, adds `seedFromVision()` three-state integration tests
3. Dev checks off M2 items #2, #3, #4 in ROADMAP.md
4. QA verifies all tests pass, confirms M2 items #2–#4 are correctly completed

### MVP Scope (this run)

- **PM (this turn):** Root-cause why M2 #2 triggered despite being implemented, scope verification + gap-fill for dev
- **Dev:** Update status message (M2 #3), add `seedFromVision()` three-state integration tests (M2 #4), verify mechanism, check off items
- **QA:** Verify all tests pass, confirm ROADMAP items correctly reflect implementation state

### Out of Scope

- M2 item #5 (acceptance: 5+ consecutive runs) — longitudinal criterion, needs tracking annotation
- Changes to `detectRoadmapExhaustedVisionOpen()` — already correct after `run_e9d2aeed559c018e`
- Changes to `seedFromVision()` dispatch logic — already correct per BUG-77
- Changes to `dispatchIdleExpansion()` or `ingestAcceptedIdleExpansion()` — not part of M2 #2–#4
- M3–M8 roadmap items
- AGENT-TALK guard failures (pre-existing, 3/8, non-blocking)

### Success Metric

1. Status message at `continuous-run.js:2292` updated to emit "Roadmap exhausted, vision still open, deriving next increment" per M2 item #3
2. Integration tests for `seedFromVision()` cover all three states: (a) roadmap has actionable work → `source: 'roadmap_open_work'`, (b) roadmap functionally exhausted + vision open → `source: 'roadmap_replenishment'`, (c) vision fully mapped → `idle: true`
3. M2 items #2, #3, #4 checked off in ROADMAP.md
4. M2 item #5 gets a tracking annotation: `<!-- tracking: 0/5 consecutive runs as of 2026-05-01 -->`
5. All existing tests continue to pass (34 vision-reader + BUG-77 integration)

## Challenge to Previous Work

### OBJ-PM-001: Prior QA cycle (run_e9d2aeed559c018e) shipped detection fix without assessing that M2 #2 was already implemented (severity: low)

The idle-expansion heuristic fix was correct and well-tested. However, the cycle treated M2 #2–#4 as future work without recognizing that BUG-77 already implemented the dispatch mechanism. This caused the vision scanner to re-trigger M2 #2 as "unchecked roadmap work" in this run. The proper action was to assess all M2 items during that cycle and check off #2 since the mechanism was already complete once the detection function was fixed.

### OBJ-PM-002: Missing integration-level regression tests for the tracked-item → replenishment flow (severity: medium)

The BUG-77 test creates a fixture with fully-checked roadmap items (`[x]`). The vision-reader unit tests cover `detectRoadmapExhaustedVisionOpen()` with tracked annotations. But there is no integration test through `seedFromVision()` that validates the tracked-item scenario: all unchecked items have `<!-- tracking: -->` annotations → `deriveRoadmapCandidates()` returns 0 → `detectRoadmapExhaustedVisionOpen()` returns `{ open: true }` → replenishment intent created. This gap means the full flow with tracked items is tested at the unit level but not the integration level.

## Notes for Dev

Your charter is **verifying the existing mechanism, filling the status message and test gaps, and checking off M2 items**.

### 1. Update status message (M2 item #3)

In `cli/src/lib/continuous-run.js`, find the log message at the `roadmap_replenishment` branch (approximately line 2292):

```javascript
log(`Roadmap-replenishment (roadmap exhausted, vision open): ${visionObjective}`);
```

Update to:

```javascript
log(`Roadmap exhausted, vision still open, deriving next increment: ${visionObjective}`);
```

### 2. Add `seedFromVision()` three-state integration tests (M2 item #4)

Add tests to `cli/test/vision-reader.test.js` (or a new file `cli/test/seed-from-vision-three-state.test.js`) that exercise `seedFromVision()` through all three states:

**State 1: Roadmap has actionable work**
- Fixture: ROADMAP with unchecked `[ ]` item (no tracking annotation), VISION with unplanned scope
- Expected: `seedFromVision()` returns `{ ok: true, idle: false, source: 'roadmap_open_work' }` (or similar non-replenishment source)

**State 2: Roadmap functionally exhausted (tracked items only) + vision open**
- Fixture: ROADMAP where all unchecked items have `<!-- tracking: ... -->` annotations, VISION with unplanned scope not mapped to any milestone
- Expected: `seedFromVision()` returns `{ ok: true, idle: false, source: 'roadmap_replenishment' }`

**State 3: Vision fully mapped**
- Fixture: ROADMAP fully checked, VISION with sections that all keyword-match existing milestones
- Expected: `seedFromVision()` returns `{ ok: true, idle: true }`

Note: `seedFromVision()` requires intake infrastructure (`.agentxchain/intake/intents/`, event recording, triage). Use a temp directory with proper intake scaffolding similar to the BUG-77 test, or mock the intake layer if unit-testing `seedFromVision()` directly.

### 3. Check off M2 items #2, #3, #4 in ROADMAP.md

After tests pass, update `.planning/ROADMAP.md`:
- Line 33: `- [x] When ROADMAP.md milestones are all checked and VISION.md has uncovered scope, dispatch PM to derive next increment`
- Line 34: `- [x] Emit clear status: "Roadmap exhausted, vision still open, deriving next increment"`
- Line 35: `- [x] Regression tests for the three-state model: run complete, roadmap exhausted, vision exhausted`

### 4. Add tracking annotation to M2 item #5

Line 36: `- [ ] Acceptance: continuous mode runs 5+ consecutive runs without idle-stopping when VISION.md has scope <!-- tracking: 0/5 consecutive runs as of 2026-05-01 -->`

### 5. Run the full test suite to confirm no regressions.

## Notes for QA

- Verify the status message update doesn't break the BUG-77 test (the test asserts `assert.match(combined, /[Rr]oadmap.replenish|[Rr]oadmap.exhausted.*vision/)` — the new message still matches this pattern)
- Verify the new three-state integration tests cover all three states
- Verify M2 items #2–#4 are correctly checked off
- Verify M2 item #5 has a tracking annotation
- Run the full test suite

## Acceptance Contract Response

1. **Roadmap milestone addressed: M2: Vision Derivation — Continuous Roadmap Replenishment** — YES. This run addresses M2 items #2, #3, and #4. The dispatch mechanism (item #2) is already implemented via BUG-77 and the detection fix from `run_e9d2aeed559c018e`. Dev work fills the status message gap (#3) and adds integration-level regression tests (#4).

2. **Unchecked roadmap item completed: When ROADMAP.md milestones are all checked and VISION.md has uncovered scope, dispatch PM to derive next increment** — YES. The mechanism is already implemented in `seedFromVision()` (continuous-run.js:1332-1403). Evidence: BUG-77 integration test passes (PM dispatched with replenishment charter, governed run completes with runs_completed=1). Dev will verify and check off.

3. **Evidence source: .planning/ROADMAP.md:33** — Line 33 is the target unchecked item. After dev implementation of gaps and QA approval, items #2–#4 will be checked off.
