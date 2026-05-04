# PM Signoff — M11: Assumption Divergence Governance (Vision Closure)

Approved: YES

**Run:** `run_a413eee8dd1891c7`
**Phase:** planning
**Turn:** `turn_9fde3fed067c1677`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running multi-agent governed delivery. The "assumptions diverge" problem surfaces when agents across turns and runs make decisions that contradict or drift from prior established decisions without explicit governance.

### Core Pain Point

VISION.md line 32 names "assumptions diverge" as one of six core problems AgentXchain exists to solve. The vision scanner triggered this run because no single milestone is labeled as closing this bullet. However, assumption divergence is addressed by a **composition of 7 delivered mechanisms** across milestones M1, M3, M5, M10, and MW. This run exists to formally verify, document, and close that vision goal.

### Challenge to Previous Turn

#### OBJ-PM-001: All planning artifacts reference stale run (severity: medium)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all reference `run_4f63b0c987a50c73` (M10 formal closure). The current run is `run_a413eee8dd1891c7`. All three artifacts rewritten from scratch.

#### OBJ-PM-002: Vision bullet "assumptions diverge" never explicitly closed (severity: high)

No prior run or milestone explicitly addressed the "assumptions diverge" vision bullet (VISION.md:32). Individual mechanisms were delivered as parts of other milestones (decision ledger in M1, dispatch context in M3, scope overlap in M10, challenge requirement in MW) but the cross-cutting concern was never verified as a whole. This created a gap where the vision scanner correctly identified the bullet as open.

### Core Workflow

1. **PM (this turn)** — Document the 7 mechanisms that collectively address assumption divergence, add M11 to ROADMAP, scope dev verification charter
2. **Dev** — Re-run all 7 mechanism test suites (183 tests) to confirm assumption-governance infrastructure is intact, no new code changes expected
3. **QA** — Verify all tests pass, confirm vision bullet coverage, check off M11 acceptance, ship verdict

### MVP Scope

**Verification-only.** No new code. The vision goal "assumptions diverge" is addressed by 7 delivered mechanisms:

| # | Mechanism | Module | Milestone | Tests |
|---|-----------|--------|-----------|-------|
| 1 | Decision ledger with cross-run persistence | `cli/src/lib/repo-decisions.js` | M1 | 39 |
| 2 | Decision history in dispatch bundles | `cli/src/lib/dispatch-bundle.js` | M3 | 12 |
| 3 | Coordinator decision ledger writes | `cli/src/lib/governed-state.js` | M1 | 7 |
| 4 | Named decisions visibility in reports | `cli/src/lib/repo-decisions.js` | M1 | 6 |
| 5 | Turn-result validator (decision schema + challenge req) | `cli/src/lib/turn-result-validator.js` | MW | 100 |
| 6 | Scope overlap guard (prevents conflicting work) | `cli/src/lib/scope-overlap.js` | M10 | 12 |
| 7 | No-edit review normalization (BUG-78 recovery) | `cli/src/lib/turn-result-validator.js` | MW | 7 |
| | **Total** | | | **183** |

**How these mechanisms prevent assumption divergence:**

1. **Decision recording** — Every turn records structured decisions (DEC-NNN) with category, statement, and rationale. No assumption is implicit.
2. **Decision persistence** — Decisions with `durability: "repo"` survive across runs via `repo-decisions.jsonl`. An agent in run N+1 sees decisions from run N.
3. **Decision visibility** — The dispatch bundle renders the last 50 decisions as a markdown table in CONTEXT.md. Every agent sees prior decisions before acting.
4. **Override authority** — `checkOverrideAuthority()` enforces role-based authority thresholds. An agent cannot silently override a prior decision without explicit authority.
5. **Challenge requirement** — Review-only roles MUST raise at least one objection (turn-result-validator.js:976). This forces cross-agent assumption checking.
6. **Scope deconfliction** — M10's scope overlap guard prevents the continuous loop from spawning runs whose charter overlaps recently completed work, preventing conflicting assumptions at the intake level.
7. **Structured workflow** — SYSTEM_SPEC.md makes assumptions explicit per run. PM_SIGNOFF.md scopes them. QA verifies them. The workflow kit ensures assumptions are written down, not implicit.

### Out of Scope

- Active contradiction detection between decisions (semantic analysis) — deferred as future enhancement, not required for vision bullet closure
- Assumption ledger separate from decisions — the decision system IS the assumption governance system
- New code changes — all 7 mechanisms already exist and are tested

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | All 7 mechanism test suites pass (183 tests, 0 failures) | Dev re-verification |
| 2 | Each mechanism's source file exists and exports expected functions | Dev spot-check |
| 3 | ROADMAP.md M11 milestone documented with evidence | PM (this turn) |
| 4 | Vision goal "assumptions diverge" addressed by composition evidence | QA ship verdict |

### Design Decisions

#### DEC-001: Previous planning artifacts described run_4f63b0c987a50c73 — all three rewritten from scratch for run_a413eee8dd1891c7, scoped as M11: Assumption Divergence Governance — Vision Closure

The vision scanner triggered this run for the "assumptions diverge" bullet in VISION.md:32. This bullet is a cross-cutting concern addressed by multiple milestones, not a single deliverable. This run documents and verifies the composition.

#### DEC-002: "assumptions diverge" is addressed by 7 delivered mechanisms across M1, M3, M10, and MW — no new code required

The decision ledger, dispatch context, override authority, challenge requirement, scope overlap guard, and structured workflow collectively prevent assumption divergence. PM independently verified all 183 tests pass (repo-decisions: 39, dispatch-bundle-decision-history: 12, coordinator-decision-ledger: 7, named-decisions-visibility: 6, scope-overlap: 12, turn-result-validator: 100, bug-78-no-edit-review: 7).

#### DEC-003: Active contradiction detection deferred — not required for vision bullet closure

The existing system prevents divergence through visibility, authority-gated overrides, and mandatory challenge. Semantic contradiction detection (comparing decision statement text for logical conflicts) would add value but is not required to satisfy the vision goal. DOGFOOD-100-TURNS is the current priority per HUMAN-ROADMAP.

#### DEC-004: Dev charter is verification-only — re-run 7 mechanism test suites, no new code expected

All mechanism code was delivered across prior milestones. Dev confirms the infrastructure is intact on the current codebase.

## Notes for Dev

**Verification-only charter.** No new code changes expected.

Run these 7 test suites:
```bash
cd cli && npx vitest run test/repo-decisions.test.js
cd cli && npx vitest run test/dispatch-bundle-decision-history.test.js
cd cli && npx vitest run test/coordinator-decision-ledger.test.js
cd cli && npx vitest run test/named-decisions-visibility.test.js
cd cli && npx vitest run test/scope-overlap.test.js
cd cli && npx vitest run test/turn-result-validator.test.js
cd cli && npx vitest run test/bug-78-no-edit-review.test.js
```

Confirm 183 tests pass with 0 failures. Spot-check that key exports exist:
- `repo-decisions.js`: `readRepoDecisions`, `getActiveRepoDecisions`, `appendRepoDecision`, `overrideRepoDecision`, `validateOverride`, `checkOverrideAuthority`
- `scope-overlap.js`: `extractScopeFingerprint`, `computeScopeOverlap`, `checkIntentScopeOverlap`
- `dispatch-bundle.js`: renders `## Decision History` section with repo decisions context

## Notes for QA

- Verify all 7 test suites pass (183 tests, 0 failures)
- Confirm each mechanism addresses an aspect of assumption divergence
- Check off ROADMAP.md M11 acceptance item after verification
- Ship verdict YES if all tests pass and vision bullet coverage is demonstrated

## Acceptance Contract

1. **Vision goal addressed: assumptions diverge** — 7 delivered mechanisms collectively prevent assumption divergence through decision recording, cross-run persistence, dispatch-time visibility, authority-gated overrides, mandatory challenge, scope deconfliction, and structured workflow artifacts. All 183 tests pass.
