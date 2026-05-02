# Acceptance Matrix — agentXchain.dev

**Run:** run_4a6f8ae7668a237a
**Turn:** turn_f41ca0d821d9c8cd (QA)
**Scope:** [Beta Bug] Continuous mode idles after run completion despite roadmap_open_work_detected

## Section A: Acceptance Contract — Continuous Mode Idle Bug

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| AC-001 | Continuous loop auto-starts next run when roadmap_open_work_detected is present after a completed run | `seedFromVision()` (continuous-run.js:1259) calls `deriveRoadmapCandidates(root)` first. If unchecked milestones exist, records `roadmap_open_work_detected` intake event (line 1268), returns `idle: false` with `source: 'roadmap_open_work'`. Calling code resets `session.idle_cycles = 0` at line 2297. BUG-76 command-chain test proves CLI-owned continuous path derives and executes M28 roadmap objective: session completes with `runs_completed: 1` and `current_vision_objective` matching `/^M28:/`. | PASS |
| AC-002 | Idle limit only triggers when there is genuinely no remaining work | Idle increment at line 2280 only fires when `seeded.idle === true` — requires both roadmap candidates AND vision candidates to be exhausted. Idle threshold check (line 2030) runs after blocked-state recovery. `continuous-run.test.js` confirms idle_cycles=2 only when all vision goals appear addressed (line 1656). BUG-77 test confirms roadmap-exhausted-but-vision-open dispatches replenishment instead of idling. | PASS |
| AC-003 | Status correctly reports pending work and next action | `appendRoadmapOpenWorkNextAction()` (status.js:703-736) pushes `{ type: 'roadmap_open_work_detected', command, reason }` when run is terminal and unchecked milestones exist. BUG-76 test line 194: `statusJson.next_actions.some((action) => action.type === 'roadmap_open_work_detected' && /M28:/.test(action.reason))`. BUG-77 test line 245: verifies `roadmap_exhausted_vision_open` next action when roadmap is fully checked but VISION has unplanned scope. | PASS |

## Section B: Code Path Verification

| Check | Detail | Status |
|-------|--------|--------|
| Roadmap derivation precedes vision scan | `seedFromVision()` line 1259: `deriveRoadmapCandidates(root)` is the first call before any vision candidate derivation | PASS |
| Idle reset on roadmap work | Line 2297: `session.idle_cycles = 0` executes when `seeded.idle` is false (roadmap or vision work found) | PASS |
| Deduplication returns idle | Lines 1283-1285 and 1289-1291: deduplicated roadmap events return `idle: true`, preventing infinite re-intake of the same milestone | PASS |
| BUG-77 roadmap exhaustion fallback | Lines 1332-1412: when roadmap has zero unchecked items, `detectRoadmapExhaustedVisionOpen()` checks for unplanned VISION sections and dispatches `roadmap_replenishment` intent | PASS |

## Section C: Regression Suites (QA-Verified)

| Suite | Count | Result |
|-------|-------|--------|
| bug-76-roadmap-open-work-continuous.test.js | 1 | PASS |
| bug-77-roadmap-exhausted-vision-open.test.js | 1 | PASS |
| continuous-run.test.js | 87 | PASS |
| governed-state.test.js | 99 | PASS |
| turn-result-validator.test.js | 100 | PASS |
| release-preflight.test.js | 15 | PASS |
| gate-evaluator.test.js | 52 | PASS |
| **QA-verified total** | **355** | **0 failures** |

## Section D: Gate Compliance Fix

| Check | Detail | Status |
|-------|--------|--------|
| RELEASE_NOTES.md contains `## User Impact` heading | Prior turn omitted this required heading — gate validator (`workflow-gate-semantics.js:259`) requires exact `## User Impact` H2 with non-placeholder content | FIXED |
| RELEASE_NOTES.md contains `## Verification Summary` heading | Present in prior turn and preserved | PASS |
| Gate validator passes both section checks | `evaluateReleaseNotes()` checks `hasReleaseNotesSectionContent()` for both sections — both now present with real content | PASS |
