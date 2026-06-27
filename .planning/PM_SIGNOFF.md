# PM Signoff — M13: Decision Trail Ownership — Vision Closure (VISION.md:34)

Approved: YES

**Run:** `run_4793c2273d675dd9`
**Phase:** planning
**Turn:** `turn_15d39107f73fd70f`
**Date:** 2026-06-26

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators and governed agent teams operating over long horizons. VISION.md line 49 identifies a core coordination failure: "nobody owns the decision trail." When multiple agents make decisions across runs, phases, and roles, decisions scatter into turn results, history entries, and transient logs — no single authority persists, enforces, renders, or provides query access to the full decision trail.

### Core Pain Point

ROADMAP.md lines 148-157 define M13 with 8 mechanisms addressing decision trail ownership. All 8 mechanisms are **already delivered** across prior milestones (M1, M3, MW, M10) and verified by PM in `run_5b6ee2a8de1bd612`. What remains is:

1. Running the full test composition (~194 tests) to confirm 0 failures on the current codebase
2. Checking off the 8 sub-items (ROADMAP.md:149-156)
3. Checking off the acceptance item (ROADMAP.md:157)
4. QA ship verdict

### Challenge to Previous Turn

#### OBJ-PM-001: All planning artifacts reference stale run (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all reference `run_71c0a7eaf361090b` (BUG-FIX: Step Auto-Checkpoint Acceptance). The current run `run_4793c2273d675dd9` targets M13: Decision Trail Ownership — a completely different milestone. All three artifacts rewritten from scratch. This is the 8th+ consecutive occurrence of stale planning artifacts needing rewrite at run start.

#### OBJ-PM-002: M13 mechanisms 1-7 overlap heavily with M11 (severity: low)

M11 (VISION.md:32 "assumptions diverge") and M13 (VISION.md:34 "nobody owns the decision trail") share 7 of 8 mechanisms. This is architecturally valid — the same infrastructure addresses both vision problems from different angles. M11 emphasizes *divergence prevention*, M13 emphasizes *ownership and access*. M13 adds mechanism #8 (operator decision CLI) which is unique to trail ownership. The overlap is a feature of compositional design, not redundancy.

### Core Workflow

1. **PM (this turn)** — Rewrite planning artifacts for M13 scope, define dev verification charter, scope acceptance
2. **Dev** — Run the 8 test suites (~194 tests) to confirm 0 failures, check off ROADMAP.md:149-157
3. **QA** — Independently verify test evidence, confirm 8 mechanisms compose to address VISION.md:34, ship verdict

### MVP Scope

**Verification-only.** No new code. All 8 mechanisms were delivered across prior milestones:

| # | Mechanism | Source Module | Test Suite | Claimed Tests |
|---|-----------|---------------|------------|---------------|
| 1 | Decision Ledger with cross-run persistence | `cli/src/lib/repo-decisions.js` | `repo-decisions.test.js` | 48 |
| 2 | Decision History in dispatch bundles | `cli/src/lib/dispatch-bundle.js` | `dispatch-bundle-decision-history.test.js` | 12 |
| 3 | Coordinator decision ledger writes (5 events) | coordinator integration | `coordinator-decision-ledger.test.js` | 7 |
| 4 | Named decisions in reports/dashboards | `cli/src/lib/report.js` | `named-decisions-visibility.test.js` | 6 |
| 5 | Turn-result validator decision schema | `cli/src/lib/turn-result-validator.js` | `turn-result-validator.test.js` | 100 |
| 6 | Scope overlap guard | `cli/src/lib/scope-overlap.js` | `scope-overlap.test.js` | 12 |
| 7 | No-edit review audit trail integrity | `cli/src/lib/turn-result-validator.js` | `bug-78-no-edit-review.test.js` | 7 |
| 8 | Operator decision CLI | `cli/src/commands/decisions.js` | within repo-decisions.test.js | 2 |
| | **Total** | | | **194** |

**How these 8 mechanisms compose to address "nobody owns the decision trail":**

| Vision Problem | Mechanism | How It Addresses Ownership |
|----------------|-----------|---------------------------|
| Decisions aren't persisted | #1 Decision Ledger | Cross-run persistent storage with 12 CRUD+query exports |
| Decisions aren't visible to agents | #2 Dispatch bundle history | Every dispatched turn sees full decision history in context |
| Decisions aren't written at key events | #3 Coordinator writes | 5 coordination events (init, dispatch, phase-transition, completion, recovery) produce ledger entries |
| Decisions aren't visible to humans | #4 Reports/dashboards | Named decisions rendered in governance reports with per-repo breakdowns |
| Decisions aren't structurally enforced | #5 Turn-result validator | DEC-NNN IDs, category, statement, rationale enforced on every turn output |
| Decision chains don't prevent conflicts | #6 Scope overlap | Intake-level guard defers overlapping work before approval |
| Review decisions aren't preserved | #7 No-edit normalization | BUG-78 Rule 0a preserves audit trail for review-only turns |
| Operators can't query decisions | #8 CLI access | `agentxchain decisions` with `--all`, `--show`, `--json` flags |

### Out of Scope

- New mechanisms or code changes — verification only
- Changes to M11's acceptance status — M11 is already closed with ship verdict
- Re-running M11 or M12 test suites beyond what M13 mechanisms require
- Expanding the decisions CLI — current feature set is sufficient for the vision closure

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | All 8 test suites pass with 0 failures (~194 tests) | Dev test output |
| 2 | Each of the 8 mechanisms verified as addressing decision trail ownership | Dev confirms composition |
| 3 | ROADMAP.md:149-156 (8 mechanism items) checked off | Dev marks them |
| 4 | ROADMAP.md:157 (acceptance item) checked off | Dev marks it |
| 5 | Vision closure confirmed: VISION.md:34/49 "nobody owns the decision trail" addressed | QA ship verdict |

### Design Decisions

#### DEC-001: Planning artifacts from run_71c0a7eaf361090b (Step Auto-Checkpoint) rewritten for run_4793c2273d675dd9 (M13: Decision Trail Ownership)

The vision scanner triggered this run for ROADMAP.md:157 — the unchecked M13 acceptance criterion. All mechanism code is delivered; this run verifies composition and formally closes the milestone.

#### DEC-002: Verification is composition-focused — 8 mechanisms must each demonstrably address an aspect of "nobody owns the decision trail"

Unlike M11 which focused on divergence prevention, M13 emphasizes ownership: persistence, visibility, enforcement, access. The dev charter requires confirming each mechanism's ownership contribution, not just test passage.

#### DEC-003: Dev charter is test-run + roadmap-check — no new code expected

All 8 mechanisms were delivered across M1, M3, MW, M10 milestones and verified by PM in run_5b6ee2a8de1bd612. Dev confirms the full test suite passes on the current codebase, then checks off ROADMAP.md:149-157.

## Notes for Dev

**Verification-only charter.** No new code changes expected.

Run the 8 decision trail test suites:
```bash
cd cli && npx vitest run test/repo-decisions.test.js test/dispatch-bundle-decision-history.test.js test/coordinator-decision-ledger.test.js test/named-decisions-visibility.test.js test/turn-result-validator.test.js test/scope-overlap.test.js test/bug-78-no-edit-review.test.js
```

Confirm ~194 tests pass with 0 failures.

Then check off all 8 mechanism items and the acceptance item in ROADMAP.md:149-157:
```markdown
- [x] Decision Ledger with cross-run persistence ...
- [x] Decision History rendered in dispatch bundles ...
- [x] Coordinator Decision Ledger writes at 5 coordination events ...
- [x] Named Decisions visibility in reports and dashboards ...
- [x] Turn-result validator enforces decision schema ...
- [x] Scope overlap guard prevents conflicting decision chains ...
- [x] No-edit review normalization preserves review decision audit trail ...
- [x] Operator decision CLI provides query access to full decision trail ...
- [x] Acceptance: all 8 mechanisms verified ...
```

## Notes for QA

- Independently run the same 8 test suites and confirm 0 failures
- Verify each mechanism addresses an aspect of "nobody owns the decision trail"
- Confirm ROADMAP.md:149-157 is fully checked off
- Ship verdict YES if all 8 mechanisms verified and acceptance criterion satisfied

## Acceptance Contract

1. **Roadmap milestone addressed: M13: Decision Trail Ownership — Vision Closure (VISION.md:34)** — M13 closes the VISION.md problem "nobody owns the decision trail" by composing 8 mechanisms for persistence, visibility, enforcement, and query access.
2. **Unchecked roadmap item completed: all 8 mechanisms verified as composition addressing VISION.md:34 "nobody owns the decision trail" — 194 tests, 0 failures** — Dev will run 8 test suites and check off ROADMAP.md:149-157.
3. **Evidence source: .planning/ROADMAP.md:157** — Line 157 contains the unchecked acceptance criterion that this run closes.
