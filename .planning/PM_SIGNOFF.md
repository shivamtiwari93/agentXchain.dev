# PM Signoff — M2: Vision Derivation (Idle-Expansion Heuristic Fix)

Approved: YES

**Run:** `run_e9d2aeed559c018e`
**Phase:** planning
**Turn:** `turn_e0f46bd030ff17de`
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

The idle-expansion heuristic cannot distinguish "current roadmap exhausted" from "vision fully addressed." Specifically, `detectRoadmapExhaustedVisionOpen()` in `vision-reader.js` counts `<!-- tracking: -->` annotated items as "unchecked" work, which short-circuits the exhaustion detection. When all remaining unchecked roadmap items have tracking annotations (longitudinal criteria that cannot be completed in a single cycle), the function returns `{ open: false, reason: 'has_unchecked' }` instead of recognizing the roadmap as functionally exhausted.

**Consequence:** `seedFromVision()` falls through to broad vision derivation (no candidates, already addressed) → returns `{ idle: true }` → idle cycles accumulate → system hits `idle_exit` or PM idle-expansion declares `vision_exhausted` → continuous mode stops prematurely even though VISION.md has unplanned scope that should trigger roadmap replenishment.

**Evidence chain:**
- M1 ROADMAP line 29: `- [ ] Acceptance: zero ghost turns across 10 consecutive self-governed runs <!-- tracking: 3/10 ... -->` — this tracked item blocks exhaustion detection
- `deriveRoadmapCandidates()` correctly skips tracked items (implemented in `run_cc4217fafd6611bc`)
- `detectRoadmapExhaustedVisionOpen()` does NOT skip tracked items — inconsistency between the two functions
- Vision has 8 milestones (M1-M8) in ROADMAP.md and many unplanned VISION.md sections

### Core Workflow

1. PM diagnoses the three-state model bug and scopes dev work (this turn)
2. Dev patches `detectRoadmapExhaustedVisionOpen()` to skip tracked items
3. Dev adds unit tests for the three-state model with tracked items
4. QA verifies the heuristic correctly distinguishes all three states

### MVP Scope (this run)

- **PM (this turn):** Root-cause the idle-expansion heuristic bug, document the three-state model, scope dev implementation, update planning artifacts
- **Dev:** Fix `detectRoadmapExhaustedVisionOpen()` to skip `<!-- tracking: -->` annotated lines, add regression tests for the three-state model
- **QA:** Verify the fix, confirm existing tests pass, validate the three-state model works end-to-end

### Out of Scope

- Changing the idle-expansion PM charter (it's adequate once the pre-expansion heuristic is fixed)
- M3-M8 roadmap items
- Checking off the M1 acceptance criterion (still at 3/10)
- Changes to `deriveRoadmapCandidates()` (already correct)
- Changes to `ingestAcceptedIdleExpansion()` or the idle-expansion result validator

### Success Metric

`detectRoadmapExhaustedVisionOpen()` treats roadmap items with `<!-- tracking: -->` annotations as functionally checked for exhaustion purposes. When all unchecked items are tracked and VISION.md has unplanned scope, the function returns `{ open: true, reason: 'roadmap_exhausted_vision_open' }` instead of `{ open: false, reason: 'has_unchecked' }`.

## Challenge to Previous Work

### OBJ-PM-001: Prior tracking annotation implementation (run_cc4217fafd6611bc) only patched half the problem (severity: medium)

The tracking annotation support added in `run_cc4217fafd6611bc` correctly patched `deriveRoadmapCandidates()` to skip tracked items, preventing re-trigger loops. However, it did not patch the paired function `detectRoadmapExhaustedVisionOpen()` — which uses its own independent `hasUnchecked` scan that doesn't respect tracking annotations. The two functions parse the same ROADMAP.md but disagree on what counts as "unchecked." This inconsistency causes the three-state model to collapse: roadmap-exhausted-but-tracked and roadmap-has-actionable-work are indistinguishable.

### OBJ-PM-002: The M2 roadmap item scope is narrower than it appears

The M2 milestone has 5 unchecked items. This run addresses only the first: "Fix idle-expansion heuristic to distinguish 'current roadmap exhausted' from 'vision fully addressed'." The remaining 4 items (dispatch PM for derivation, emit clear status, regression tests for three-state model, acceptance criterion) are partially addressed by existing BUG-77 code but not fully testable until this fix lands. The acceptance contract for this run targets only the first item.

## Notes for Dev

Your charter is **fixing `detectRoadmapExhaustedVisionOpen()` in `cli/src/lib/vision-reader.js`**:

1. In `detectRoadmapExhaustedVisionOpen()` (line 482-492), the `hasUnchecked` loop currently does:
   ```javascript
   if (currentMilestone && /^\s*[-*]\s+\[\s\]/.test(line)) {
     hasUnchecked = true;
   }
   ```
   Add a guard to skip lines matching `ROADMAP_TRACKING_ANNOTATION_PATTERN` (already defined at line 18). The corrected logic:
   ```javascript
   if (currentMilestone && /^\s*[-*]\s+\[\s\]/.test(line) && !ROADMAP_TRACKING_ANNOTATION_PATTERN.test(line)) {
     hasUnchecked = true;
   }
   ```

2. Add unit tests for `detectRoadmapExhaustedVisionOpen` in `cli/test/vision-reader.test.js`:
   - All unchecked items tracked → function proceeds to VISION check → returns `{ open: true }` if vision has unplanned scope
   - Mix of tracked + genuinely unchecked items → `{ open: false, reason: 'has_unchecked' }` (existing behavior preserved)
   - All items checked (no `[ ]` at all) → existing behavior preserved
   - All items tracked + vision fully mapped → `{ open: false, reason: 'vision_fully_mapped' }`

3. Run the full vision-reader test suite to confirm no regressions.

## Notes for QA

- Verify the fix handles edge cases: tracking annotation with extra whitespace, partial annotation, multiple tracked items
- Verify the existing BUG-77 command-chain test still passes
- Verify `deriveRoadmapCandidates()` and `detectRoadmapExhaustedVisionOpen()` now agree on what counts as "unchecked"
- Run the full test suite

## Acceptance Contract Response

1. **Roadmap milestone addressed: M2: Vision Derivation — Continuous Roadmap Replenishment** — YES. The idle-expansion heuristic fix is the first and most critical M2 item. It enables the three-state model (run complete / roadmap exhausted / vision exhausted) that the remaining M2 items depend on.

2. **Unchecked roadmap item completed: Fix idle-expansion heuristic to distinguish "current roadmap exhausted" from "vision fully addressed"** — YES. The fix is scoped: patch `detectRoadmapExhaustedVisionOpen()` to respect `<!-- tracking: -->` annotations, bringing it into consistency with `deriveRoadmapCandidates()`. This enables correct three-state detection.

3. **Evidence source: .planning/ROADMAP.md:32** — Line 32 is the target unchecked item. After dev implementation and QA approval, this item will be checked off.
