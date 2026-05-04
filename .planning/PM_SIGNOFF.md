# PM Signoff — M13: Decision Trail Ownership — Vision Closure (VISION.md:34)

Approved: YES

**Run:** `run_5b6ee2a8de1bd612`
**Phase:** planning
**Turn:** `turn_5ea0fb48212534dd`
**Date:** 2026-05-04

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running multi-agent governed delivery over long horizons. The "nobody owns the decision trail" problem surfaces when decisions made during agent turns are ephemeral — no persistent audit, no authority chain, no way for later agents or operators to know who decided what, why, and with what authority. In ungoverned systems, decisions are implicit artifacts of code changes rather than explicit, owned governance records.

### Core Pain Point

VISION.md line 34 names "nobody owns the decision trail" as one of six core problems AgentXchain exists to solve. The vision scanner triggered this run because no single milestone is labeled as closing this bullet. However, decision trail ownership is addressed by a **composition of 8 delivered mechanisms** across milestones M1, M3, M10, MW, and the protocol layer. This run exists to formally verify, document, and close that vision goal.

**Distinction from M11 (Assumption Divergence Governance):** M11 closed VISION.md:32 "assumptions diverge" — focused on preventing contradictory decisions across turns via visibility and scope overlap detection. M13 closes VISION.md:34 "nobody owns the decision trail" — focused on persistent ownership, authority enforcement, and operator auditability of the decision record itself. The mechanisms overlap significantly (the decision ledger is central to both) but the governance concerns are distinct: M11 prevents divergence, M13 ensures ownership.

### Challenge to Previous Turn

#### OBJ-PM-001: All planning artifacts reference stale run (severity: medium)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all reference `run_08c9a1482479ae2e` (M12: Quality Drift Prevention). The current run is `run_5b6ee2a8de1bd612`. All three artifacts rewritten from scratch. This is the seventh consecutive run with stale-artifact carryover — a persistent pattern where planning artifacts from the previous run survive into the next.

#### OBJ-PM-002: Vision bullet "nobody owns the decision trail" never explicitly closed (severity: high)

No prior run or milestone explicitly addressed the "nobody owns the decision trail" vision bullet (VISION.md:34). The decision ledger was built as part of M1 and expanded in M11, but M11's formal closure was for "assumptions diverge" (VISION.md:32). The decision authority model, override protocol, operator CLI, and cross-run persistence collectively address ownership but were never verified as a composition for this specific vision goal.

### Core Workflow

1. **PM (this turn)** — Document the 8 mechanisms that collectively provide decision trail ownership, add M13 to ROADMAP, scope dev verification charter
2. **Dev** — Re-run all 8 decision-trail test suites (194 tests) to confirm decision ownership infrastructure is intact, no new code changes expected
3. **QA** — Verify all tests pass, confirm vision bullet coverage, check off M13 acceptance, ship verdict

### MVP Scope

**Verification-only.** No new code. The vision goal "nobody owns the decision trail" is addressed by 8 delivered mechanisms:

| # | Mechanism | Module | Milestone | Tests |
|---|-----------|--------|-----------|-------|
| 1 | Decision Ledger with cross-run persistence | `cli/src/lib/repo-decisions.js` | M1 | 48 |
| 2 | Decision History in dispatch bundles | `cli/src/lib/dispatch-bundle.js` | M3 | 12 |
| 3 | Coordinator Decision Ledger (5 governance events) | `cli/src/lib/governed-state.js` | M1 | 7 |
| 4 | Named Decisions for multi-repo coordination | multi-repo coordination layer | M1 | 6 |
| 5 | Turn-Result Validator enforces decision schema | `cli/src/lib/turn-result-validator.js` | MW | 100 |
| 6 | Scope Overlap Guard (prevents conflicting decisions) | `cli/src/lib/scope-overlap.js` | M10 | 12 |
| 7 | No-Edit Review Normalization (decision audit integrity) | `cli/src/lib/turn-result-validator.js` | MW | 7 |
| 8 | Status/CLI decision surface for operators | `cli/src/commands/decisions.js` | M1 | 2 |
| | **Total** | | | **194** |

**How these mechanisms ensure "someone owns the decision trail":**

1. **Decision Ledger with cross-run persistence** — `repo-decisions.js` provides 12 exported functions for decision CRUD, authority resolution, and rendering. Decisions marked with `durability: "repo"` persist in `.agentxchain/repo-decisions.jsonl` across run boundaries. Decisions are not ephemeral — they are durable, queryable, owned records with role attribution, authority level, and timestamp.

2. **Decision History in dispatch bundles** — Every agent receives a "Decision History" section in CONTEXT.md showing the last 50 decisions from the current run plus all active repo-level decisions. Agents cannot claim ignorance of prior decisions. The trail is proactively surfaced, not hidden.

3. **Coordinator Decision Ledger** — The framework itself records governance decisions at 5 critical coordination events: init, dispatch, phase-transition, completion, and recovery. These are not agent decisions — they are framework decisions, ensuring the coordination layer itself has an auditable trail.

4. **Named Decisions for multi-repo coordination** — Workstreams can declare required decision IDs per repo as completion barriers (`named_decisions.decision_ids_by_repo`). Decision ownership extends across repository boundaries. A multi-repo delivery cannot complete unless named decisions are satisfied per repo.

5. **Turn-Result Validator enforces decision schema** — Every turn result must declare decisions with DEC-NNN IDs, a category (implementation/architecture/scope/process/quality/release), a non-empty statement, and a non-empty rationale. Decisions without proper attribution are rejected at the protocol boundary. The trail is structurally enforced, not voluntary.

6. **Scope Overlap Guard** — Prevents agents from starting work that overlaps with active decisions. When a new intent's charter fingerprint overlaps significantly with an active run, the system defers it. This prevents conflicting decision chains from forming in the first place.

7. **No-Edit Review Normalization** — Ensures the decision audit trail is not corrupted by false positives from the validation pipeline. Review turns (which record challenge decisions and objections) are correctly normalized so they pass validation without requiring artificial file changes.

8. **Status/CLI decision surface for operators** — `agentxchain decisions` command provides operator-facing query access to the decision trail: `--all` for historical decisions, `--show DEC-NNN` for detail, `--json` for machine-readable export. Operators OWN the ability to inspect, understand, and audit the full decision trail at any time.

### Out of Scope

- Active contradiction detection between decisions (deferred — not required for vision bullet closure)
- Decision impact analysis ("which decisions influenced this code change") — useful but not part of ownership
- Decision lifecycle states beyond active/overridden — current binary model is sufficient
- New code changes — all 8 mechanisms already exist and are tested

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | All 8 decision-trail test suites pass (194 tests, 0 failures) | Dev re-verification |
| 2 | `repo-decisions.js` exports 12 decision management functions | Dev spot-check |
| 3 | `decisions` CLI command provides operator query access | Dev spot-check |
| 4 | Decision authority model enforces hierarchical override rules | Dev spot-check of `validateOverride`, `resolveDecisionAuthority` |
| 5 | Dispatch bundles render decision history for agent visibility | Dev spot-check of dispatch-bundle.js |
| 6 | ROADMAP.md M13 milestone documented with evidence | PM (this turn) |
| 7 | Vision goal "nobody owns the decision trail" addressed by composition | QA ship verdict |

### Design Decisions

#### DEC-001: Previous planning artifacts described run_08c9a1482479ae2e — all three rewritten from scratch for run_5b6ee2a8de1bd612, scoped as M13: Decision Trail Ownership — Vision Closure

The vision scanner triggered this run for the "nobody owns the decision trail" bullet in VISION.md:34. This bullet is addressed by a composition of 8 mechanisms across M1, M3, M10, and MW. This run documents and verifies the composition, formally closing the vision goal.

#### DEC-002: "Nobody owns the decision trail" is distinct from "assumptions diverge" — different governance concerns addressed by overlapping mechanisms

M11 closed "assumptions diverge" (VISION.md:32) via visibility and consistency mechanisms. M13 closes "nobody owns the decision trail" (VISION.md:34) via ownership, authority, and auditability mechanisms. The decision ledger is central to both, but the concerns are distinct: M11 prevents contradictions, M13 ensures accountability.

#### DEC-003: Decision trail ownership requires both persistence AND authority enforcement — not just logging

A decision log without authority is just a changelog. The decision authority model (`decision_authority` per role, `validateOverride()`, `resolveDecisionAuthority()`) ensures decisions are not just recorded but owned — with clear rules about who can override whom. This is what transforms the trail from a passive log into an owned governance artifact.

#### DEC-004: Dev charter is verification-only — re-run 8 decision-trail test suites, no new code expected

All mechanism code was delivered across prior milestones. Dev confirms the infrastructure is intact on the current codebase.

## Notes for Dev

**Verification-only charter.** No new code changes expected.

Run these 8 test suites:
```bash
cd cli && npx vitest run test/repo-decisions.test.js
cd cli && npx vitest run test/dispatch-bundle-decision-history.test.js
cd cli && npx vitest run test/coordinator-decision-ledger.test.js
cd cli && npx vitest run test/named-decisions-visibility.test.js
cd cli && npx vitest run test/turn-result-validator.test.js
cd cli && npx vitest run test/scope-overlap.test.js
cd cli && npx vitest run test/bug-78-no-edit-review.test.js
cd cli && npx vitest run test/status-repo-decisions.test.js
```

Confirm 194 tests pass with 0 failures. Spot-check that key decision-ownership mechanisms exist:
- `repo-decisions.js`: 12 exports including `appendRepoDecision`, `overrideRepoDecision`, `validateOverride`, `resolveDecisionAuthority`, `getDecisionAuthorityMetadata`, `renderRepoDecisionsMarkdown`
- `decisions.js` command: `--all`, `--show`, `--json` options
- `dispatch-bundle.js`: Decision History table rendered in CONTEXT.md (line ~1416)
- `turn-result-validator.js`: DEC-NNN schema enforcement, challenge requirement at line 976

## Notes for QA

- Verify all 8 test suites pass (194 tests, 0 failures)
- Confirm each mechanism addresses an aspect of decision trail ownership (not just logging)
- Check off ROADMAP.md M13 acceptance item after verification
- Ship verdict YES if all tests pass and vision bullet coverage is demonstrated

## Acceptance Contract

1. **Vision goal addressed: nobody owns the decision trail** — 8 delivered mechanisms collectively ensure decision trail ownership through persistent cross-run ledger (repo-decisions.js, 12 exports), authority enforcement (decision_authority model with hierarchical override), agent visibility (dispatch bundle decision history), operator auditability (decisions CLI command), structural schema enforcement (turn-result validator DEC-NNN), coordinator governance events (5 critical events), multi-repo named decisions, and scope overlap prevention. All 194 tests pass.
