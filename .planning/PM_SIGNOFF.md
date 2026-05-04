# PM Signoff — MW: Workflow Kit Recovery — BUG-78 No-Edit Review Fix

Approved: YES

**Run:** `run_5e7a4020b052bc68`
**Phase:** planning
**Turn:** `turn_dedcba0327220bf1`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running governed multi-agent runs in full-auto continuous mode, where review-only roles (e.g. product_marketing, security_reviewer, technical_writer) perform no-edit analysis turns.

### Core Pain Point

BUG-78: When a review-only role completes a valid no-edit turn and emits `artifact.type: "workspace"` with `files_changed: []`, AgentXchain correctly rejects the inconsistency at Stage C validation but the continuous loop cannot auto-recover — it pauses and requires manual JSON surgery on `.agentxchain/staging/<turn>/turn-result.json`. This directly blocks the DOGFOOD-100-TURNS credibility gate (HUMAN-ROADMAP top priority) and is the last remaining gap in the workflow kit's recovery layer.

**Evidence of the bug:** Reproduced by tusq.dev beta tester on agentxchain@2.155.26 (2026-04-26). The product_marketing role performed valid launch readiness review, turn was rejected, manual `jq` edit of staging JSON to change `workspace` → `review` was required to unblock the continuous loop.

### Challenge to Previous Turn

#### OBJ-PM-001: All three planning artifacts reference wrong run (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md phases table all referenced run_0cd65963809561d6 (CI reporter verification). This is run_5e7a4020b052bc68 with charter "[vision] What We Are Building: an opinionated workflow layer for planning, specs, documentation, testing, QA, release, and recovery." The dev turn (turn_4ba1bb436277fb74) correctly fixed SYSTEM_SPEC.md headers for the old run's gate, but the content is for the wrong scope. All three artifacts rewritten from scratch.

#### OBJ-PM-002: No milestone addresses the workflow layer vision pillar (severity: medium)

ROADMAP.md had milestones M1-M9 covering governance, vision derivation, multi-model handoff, recovery, parallel turns, dashboard, connectors, managed surface, and CI — but no milestone that explicitly addresses VISION.md §4 "Workflow Kit: the opinionated operating model for real software delivery." The workflow kit was built incrementally across other milestones. Added MW milestone to formally close this pillar.

### Core Workflow (this run)

1. **PM (this turn)** — Audit workflow kit against VISION.md §4, identify BUG-78 as the remaining gap, rewrite planning artifacts, add MW milestone
2. **Dev** — Expand Rule 0a in turn-result-validator.js, write 6 regression tests
3. **QA** — Verify BUG-78 fix, confirm all 8 workflow concerns, check off MW acceptance

### MVP Scope (this run)

**One-line code change + 6 regression tests.**

The fix adds `|| normalized.status === 'completed'` to Rule 0a's condition block (turn-result-validator.js:1527). This makes the normalizer auto-correct `workspace` → `review` for completed no-edit turns, eliminating the need for manual JSON surgery.

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Rewritten for run_5e7a4020b052bc68 with BUG-78 scope
2. SYSTEM_SPEC.md: Precise fix spec with insertion point, behavioral guarantees, test matrix
3. ROADMAP.md: MW milestone added with 8 delivered workflow concerns + BUG-78 gap + acceptance item

**Dev deliverables:**
1. Edit turn-result-validator.js: add one condition line to Rule 0a
2. Create bug-78-no-edit-review.test.js: 6 regression tests (AT-WK-001 through AT-WK-006)
3. Verify existing gate/validator tests still pass

**QA deliverables:**
1. Verify 6 new tests pass
2. Verify existing test suites unaffected
3. Confirm all 8 workflow concerns are delivered with evidence
4. Check off MW acceptance on ROADMAP.md
5. Write acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md

### Out of Scope

- Changes to Stage C validation logic (line 696-707)
- Changes to review→workspace guard (line 716-728)
- Changes to any other module (governed-state.js, run-loop.js, etc.)
- New normalizer rules beyond the status=completed condition
- Workflow kit feature additions (new templates, new phases, new artifact types)
- Any work unrelated to BUG-78 or workflow kit vision pillar closure

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | Vision goal addressed: opinionated workflow layer | MW milestone on ROADMAP.md with all 8 concerns checked + BUG-78 closed |
| 2 | BUG-78 fixed: completed no-edit turns auto-normalize | AT-WK-001 + AT-WK-006 pass |
| 3 | No regression in existing validation | workflow-gate-semantics.test.js + gate-evaluator.test.js + turn-result-validator.test.js pass |
| 4 | Status guard preserved (failed/blocked turns NOT normalized) | AT-WK-003 + AT-WK-004 pass |
| 5 | Files_changed guard preserved | AT-WK-002 pass |
| 6 | Produced_files guard preserved | AT-WK-005 pass |

### Design Decisions

#### DEC-001: Previous planning artifacts described run_0cd65963809561d6 — rewritten from scratch for run_5e7a4020b052bc68

The vision scan opened this run for the "workflow layer" charter, not CI reporter verification. All three planning artifacts rewritten.

#### DEC-002: Workflow kit already implements all 8 VISION.md §4 concerns — MW milestone audits and formally closes the pillar

The workflow kit was built incrementally across M1-M9 but no milestone explicitly addressed it. MW enumerates all 8 concerns (planning, specs, implementation, QA, release, escalation, recovery, documentation) with evidence, plus the BUG-78 gap.

#### DEC-003: BUG-78 fix scoped as minimal Rule 0a expansion — `|| normalized.status === 'completed'`

The fix adds one condition line rather than restructuring the normalizer. This is safe because: (a) turns with empty files_changed and status=completed genuinely have no repo mutations, (b) the normalization is recorded in normalizationEvents for audit, (c) Stage C remains the safety net for non-normalized turns.

#### DEC-004: BUG-78 fix directly serves DOGFOOD-100-TURNS credibility gate

HUMAN-ROADMAP explicitly identifies BUG-78 as "open for natural no-edit review proof." Fixing this is aligned with the top human priority (substrate hardening for dogfood) and the vision charter (workflow recovery completeness).

## Notes for Dev

**Minimal change.** One condition line added to turn-result-validator.js Rule 0a. Six regression tests in a new file. See SYSTEM_SPEC.md §2 for exact insertion point and test matrix.

Do NOT modify:
- Stage C validation (lines 696-707)
- Review→workspace guard (lines 716-728)
- Implementation-phase product-code guard (lines 733-739)
- Any module outside turn-result-validator.js

## Notes for QA

- Run bug-78-no-edit-review.test.js: all 6 tests must pass
- Run workflow-gate-semantics.test.js and gate-evaluator.test.js: no regressions
- Run turn-result-validator.test.js if it exists: no regressions
- Verify ROADMAP.md MW items are checked (8 delivered concerns)
- Check off MW acceptance item after verification
- Confirm normalization event is recorded when fix fires

## Acceptance Contract

1. **Vision goal addressed: an opinionated workflow layer for planning, specs, documentation, testing, QA, release, and recovery** — All 8 workflow concerns audited and confirmed delivered on ROADMAP.md MW milestone. The one gap (BUG-78 recovery) is fixed in this run. Evidence: 7 semantic validators, 7 governed templates, recovery classification, release alignment, human escalation, plus BUG-78 fix with 6 regression tests.

## API Map

| Module | Status | Purpose |
|--------|--------|---------|
| `cli/src/lib/turn-result-validator.js` | Modified (this run) | Rule 0a expanded: workspace→review for completed no-edit turns |
| `cli/test/bug-78-no-edit-review.test.js` | New (this run) | 6 regression tests for BUG-78 fix |
| `cli/src/lib/workflow-gate-semantics.js` | Exists (unchanged) | 7 semantic validators for workflow artifacts |
| `cli/src/lib/workflow-kit-phase-templates.js` | Exists (unchanged) | Phase template definitions (planning, implementation, QA) |
| `cli/src/lib/workflow-kit-artifacts.js` | Exists (unchanged) | Artifact derivation from config |
| `cli/src/lib/gate-evaluator.js` | Exists (unchanged) | Phase-exit gate evaluation |
| `cli/src/lib/recovery-classification.js` | Exists (unchanged) | Recovery event classification (4 domains) |
| `cli/src/lib/human-escalations.js` | Exists (unchanged) | Human escalation tracking |
| `cli/src/lib/release-alignment.js` | Exists (unchanged) | Release surface validation (8 dimensions) |
| `cli/src/lib/governed-templates.js` | Exists (unchanged) | 7 governed template manifests |
