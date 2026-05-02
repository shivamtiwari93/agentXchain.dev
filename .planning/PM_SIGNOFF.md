# PM Signoff — M1: Ghost Turn Elimination (Vision Scanner Re-Trigger Fix)

Approved: YES

**Run:** `run_cc4217fafd6611bc`
**Phase:** planning
**Turn:** `turn_cf0f0e619c3d4118`
**Date:** 2026-05-02

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running continuous vision-driven mode with local_cli runtimes.

### Core Pain Point

The vision scanner's `deriveRoadmapCandidates()` has no mechanism to recognize longitudinal ROADMAP items — items that require evidence from multiple runs and cannot be completed in a single cycle. The M1 acceptance criterion "zero ghost turns across 10 consecutive self-governed runs" is the first instance. The scanner re-triggers a new run each time a prior run completes without checking off this item, creating a budget-wasting infinite loop.

**Evidence of the loop:**
- `run_936b36c729c01f54` — PM explicitly said acceptance criterion is correctly left unchecked (DEC-003), run completed
- `run_cc4217fafd6611bc` (this run) — vision scanner immediately re-triggered for the same unchecked item
- Intent `intent_1777682531305_4f73` was created because no completed intent has sufficient keyword overlap (prior completed intents `_af6e` and `_4275` covered "Diagnose root cause" and "Add startup heartbeat", not "Acceptance: zero ghost turns...")

### Core Workflow

1. PM diagnoses the re-trigger loop and scopes dev work (this turn)
2. Dev adds `<!-- tracking: -->` annotation recognition to `deriveRoadmapCandidates()` in `vision-reader.js`
3. Dev annotates the M1 acceptance item in ROADMAP.md with tracking status
4. Dev adds regression tests for the skip behavior
5. QA verifies the scanner correctly skips annotated items and the annotation is accurate

### MVP Scope (this run)

- **PM (this turn):** Document the re-trigger root cause, scope dev implementation, update planning artifacts
- **Dev:** Implement `<!-- tracking: -->` annotation parsing in `deriveRoadmapCandidates()`, add tests, annotate ROADMAP.md
- **QA:** Verify scanner skip logic, verify annotation accuracy against run history, confirm no regressions

### Out of Scope

- Checking off the M1 acceptance criterion (only 3/10 consecutive zero-ghost runs achieved)
- Vision-level deferred classification (already exists in `idle-expansion-result-validator.js`, works at heading level not item level)
- M2-M8 roadmap items
- DOGFOOD-100 (paused on credential blocker)
- Intent dedup improvements (keyword overlap is working correctly — the problem is that no completed intent addresses this specific goal)

### Success Metric

`deriveRoadmapCandidates()` skips ROADMAP items annotated with `<!-- tracking: -->`. The M1 acceptance item is annotated with current streak evidence. Future vision scans no longer re-trigger runs for this item.

## Challenge to Previous Work

### OBJ-PM-001: Prior PM identified the re-trigger risk but proposed no fix (severity: medium)

The PM in `run_936b36c729c01f54` (DEC-003) explicitly stated: "The M1 acceptance criterion is correctly left unchecked — it requires dogfood runs over time, not a single implementation cycle." This is correct analysis. But the PM failed to address the obvious consequence: the vision scanner will keep triggering new runs for this item. This run is proof of that failure. Three consecutive runs have now touched M1 without making progress on the acceptance criterion itself — budget spent on reconciliation and re-analysis rather than building the mechanism to prevent re-triggering.

### OBJ-PM-002: The acceptance contract for this run cannot be literally satisfied

The intake acceptance contract states "Unchecked roadmap item completed: Acceptance: zero ghost turns across 10 consecutive self-governed runs." This item CANNOT be completed this run — we have only 3 consecutive zero-ghost runs (runs `8485b804`, `984f0f8c`, `936b36c7`). Checking it off would be dishonest. Instead, this run will:
1. Fix the re-trigger mechanism so we stop wasting budget on empty reconciliation runs
2. Annotate the item with longitudinal tracking evidence (3/10)
3. Let the criterion accumulate naturally across future governed runs

## Notes for Dev

Your charter is **implementation of tracking annotation support in the vision scanner**:

1. Modify `deriveRoadmapCandidates()` in `cli/src/lib/vision-reader.js` (line 260-267):
   - After the `uncheckedMatch` regex, check if the line contains `<!-- tracking:` followed by any content and `-->`
   - If the annotation is present, skip the item (do not add to candidates)
   - The annotation format: `<!-- tracking: <description> -->`

2. Add regression tests in `cli/test/vision-reader.test.js` (or create if needed):
   - Unchecked item WITHOUT annotation → included in candidates (existing behavior)
   - Unchecked item WITH `<!-- tracking: ... -->` → excluded from candidates
   - Checked item with annotation → still excluded (already excluded by `[x]`)

3. Annotate the M1 acceptance item in `.planning/ROADMAP.md` line 29:
   ```
   - [ ] Acceptance: zero ghost turns across 10 consecutive self-governed runs <!-- tracking: 3/10 zero-ghost runs (8485b804, 984f0f8c, 936b36c7) as of 2026-05-02 -->
   ```

4. Run the existing vision-reader tests + your new tests to confirm no regressions.

## Notes for QA

- Verify the `<!-- tracking: -->` regex doesn't false-positive on normal HTML comments in ROADMAP items
- Verify the annotation text accurately reflects the zero-ghost run history (cross-check history.jsonl)
- Confirm the 3 cited runs (`8485b804`, `984f0f8c`, `936b36c7`) all completed with zero ghost turns
- Confirm existing `deriveRoadmapCandidates` behavior is preserved for non-annotated items
- Run the full vision-reader test suite

## Acceptance Contract Response

1. **Roadmap milestone addressed: M1: Self-Governance Hardening — Ghost Turn Elimination** — YES. The re-trigger loop is a direct consequence of M1's longitudinal acceptance criterion. Fixing the scanner to support tracking annotations is necessary M1 completion infrastructure.

2. **Unchecked roadmap item completed: Acceptance: zero ghost turns across 10 consecutive self-governed runs** — CANNOT BE COMPLETED THIS RUN. Only 3/10 consecutive zero-ghost runs exist. Instead, this run prevents the wasteful re-trigger loop and annotates the item with tracking evidence so progress accumulates across future runs.

3. **Evidence source: .planning/ROADMAP.md:29** — Will be annotated with `<!-- tracking: 3/10 -->` after dev implementation.
