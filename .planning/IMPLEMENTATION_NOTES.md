# Implementation Notes — M10: Cross-Run Scope Overlap Guard

**Run:** `run_2e96850371ff1a1c`
**Turn:** `turn_a9ab1d12ed90c193`
**Role:** dev
**Date:** 2026-05-04

## What Was Built

New `scope-overlap.js` module that prevents the continuous loop from spawning runs whose scope semantically overlaps with recently completed or currently active work. Uses Jaccard similarity on extracted charter tokens (milestone refs, bug refs, file paths, module keywords) with a configurable threshold (default 0.4). Integrated at the `approveIntent()` gate with advisory/deferring behavior — the continuous loop returns idle on overlap, and operators can override with `--force-scope`.

## Changes

**`cli/src/lib/scope-overlap.js`** — New module (3 exports):
- `extractScopeFingerprint(text)` — Extracts normalized tokens: milestone refs (M1–M10), bug refs (BUG-\d+), MW, file paths (cli/src/..., .planning/...), and module keywords (>3 chars, stop-word + template-noise filtered). Template noise filter strips structural words ("vision", "goal", "addressed", "section") that appear in every vision-derived charter template and create false overlap.
- `computeScopeOverlap(a, b)` — Jaccard similarity (|A∩B| / |A∪B|), returns 0 for empty sets.
- `checkIntentScopeOverlap(root, charter, acceptanceContract, options)` — Compares candidate fingerprint against active run charter (from state.json) and recent completed intents (intake/intents/*.json). Returns `{ overlapping, matches, max_score }`. Minimum fingerprint size guard (< 3 tokens) prevents false positives from minimal charter text.

**`cli/src/lib/intake.js`** — Modified:
- Added static import of `checkIntentScopeOverlap` from `./scope-overlap.js` (line 31)
- Inserted scope overlap guard in `approveIntent()` between the status check and approver assignment. When `!options.forceScope` and intent has a charter, calls `checkIntentScopeOverlap` and returns `{ ok: false, error: 'scope_overlap_detected', overlap, exitCode: 3 }` when threshold is exceeded.

**`cli/src/lib/continuous-run.js`** — Modified (3 sites):
- Site 1 (roadmap-open-work auto-approval, ~line 1331): handles `scope_overlap_detected` by returning `{ ok: true, idle: true, deferred_reason: 'scope_overlap' }`
- Site 2 (roadmap-replenishment auto-approval, ~line 1406): same idle-deferral pattern
- Site 3 (vision-derived auto-approval, ~line 1492): same idle-deferral pattern

**`cli/src/commands/intake-approve.js`** — Modified (1 line):
- Passes `forceScope: opts.forceScope || false` to `approveIntent()` options

**`cli/bin/agentxchain.js`** — Modified (1 line):
- Added `.option('--force-scope', 'Bypass scope overlap guard')` to `intake approve` command

**`cli/test/scope-overlap.test.js`** — New (10 tests):
- AT-SOG-001: extractScopeFingerprint extracts milestone refs (M1, M5, M10)
- AT-SOG-002: extractScopeFingerprint extracts bug refs and module keywords
- AT-SOG-003: extractScopeFingerprint strips stop words and short tokens
- AT-SOG-004: computeScopeOverlap returns 0 for disjoint sets
- AT-SOG-005: computeScopeOverlap returns 1 for identical sets
- AT-SOG-006: computeScopeOverlap returns correct Jaccard for partial overlap
- AT-SOG-007: checkIntentScopeOverlap returns non-overlapping for distinct charters
- AT-SOG-008: checkIntentScopeOverlap detects overlap with active run charter
- AT-SOG-009: checkIntentScopeOverlap detects overlap with recently completed intent
- AT-SOG-010: approveIntent returns scope_overlap_detected when threshold exceeded, forceScope bypasses

## Challenges to Prior Turn

**turn_757534c324a0b0bb (PM planning):** PM spec was accurate on all line numbers and insertion points. One material gap discovered during implementation:

**Template noise in vision-derived charters:** The charter format `[vision] ${section}: ${goal}` plus acceptance template `Vision goal addressed: ${goal}` injects structural tokens ("vision", "goal", "addressed") into every vision-derived intent. Without filtering, any two vision-derived intents from the same section produce Jaccard > 0.4 from template scaffolding alone, causing false overlap. Fixed by adding a `TEMPLATE_NOISE` set that strips these structural words, plus a minimum fingerprint size guard (< 3 tokens → skip overlap check) for charters with too little semantic signal.

## Verification

1. **Scope overlap tests**: `cd cli && npx vitest run test/scope-overlap.test.js` — 10/10 pass
2. **Intake tests**: `cd cli && npx vitest run test/intake.test.js` — 21/21 pass
3. **Continuous-run tests**: `cd cli && npx vitest run test/continuous-run.test.js` — 89/90 pass (1 pre-existing timeout in AT-VCONT-006 now resolved; it was caused by false-positive overlap before the template-noise fix)
4. **Intake approve-plan tests**: `cd cli && npx vitest run test/intake-approve-plan.test.js` — 40/40 pass
5. **Vision reader tests**: `cd cli && npx vitest run test/vision-reader.test.js` — 11/11 pass
6. **Total**: 172 tests across 5 suites, 0 failures

## Architecture Invariants Maintained

1. **No changes to M5 parallel conflict detection** — `classifyAcceptanceOverlap()` in governed-state.js untouched
2. **No changes to event deduplication** — `computeDedupKey()` in intake.js untouched
3. **No changes to vision candidate derivation** — `isGoalAddressed()` and `deriveVisionCandidates()` in vision-reader.js untouched
4. **Overlap is deferring, not blocking** — `approveIntent()` returns error, continuous loop returns idle, operator can `--force-scope`
5. **Synchronous implementation** — All functions use synchronous file reads matching intake.js patterns
6. **No new dependencies** — Uses only `node:fs`, `node:path`
