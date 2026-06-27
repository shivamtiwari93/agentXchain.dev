# System Spec — M13: Decision Trail Ownership — Vision Closure (VISION.md:34)

**Run:** `run_4793c2273d675dd9`
**Baseline:** git:c5f77e94d (HEAD of dogfood/2157-lights-out)

## Purpose

This run formally closes ROADMAP.md M13 (lines 148-157): "Decision Trail Ownership — Vision Closure (VISION.md:34)."

VISION.md line 49 identifies a core coordination failure when multiple agents touch the same codebase over time: "nobody owns the decision trail." Without ownership, decisions scatter into transient turn outputs, get lost across runs, and become unqueryable. Operators have no way to inspect what was decided, when, or why.

M13 addresses this by composing 8 mechanisms — all delivered across prior milestones (M1, M3, MW, M10) — that collectively provide:

- **Persistence**: decisions survive across runs via a structured ledger
- **Visibility**: decisions appear in dispatch context and governance reports
- **Enforcement**: the protocol writes decisions at key events and validates their structure
- **Integrity**: scope overlap and review normalization protect the trail
- **Access**: operators can query the full decision trail via CLI

All code is delivered. This run is verification-only: confirm ~194 tests pass and check off the milestone.

## Interface

### Mechanism 1: Decision Ledger with Cross-Run Persistence

**Module:** `cli/src/lib/repo-decisions.js`
**Test suite:** `cli/test/repo-decisions.test.js` (48 tests)

12 exports: `readRepoDecisions`, `getActiveRepoDecisions`, `appendRepoDecision`, `overrideRepoDecision`, `validateOverride`, `resolveDecisionAuthority`, `getDecisionAuthorityMetadata`, `renderRepoDecisionsMarkdown`, `summarizeRepoDecisions`, `buildRepoDecisionOperatorSummary`, plus query/filter functions.

Persists decisions in `.agentxchain/decision-ledger.jsonl` with structured fields (id, category, statement, rationale, run_id, turn_id, role, phase). Supports override chains with authority validation.

### Mechanism 2: Decision History in Dispatch Bundles

**Module:** `cli/src/lib/dispatch-bundle.js` (Decision History section ~line 1416, repo decisions context ~line 775)
**Test suite:** `cli/test/dispatch-bundle-decision-history.test.js` (12 tests)

Every dispatched turn receives the full decision history table in its context bundle. Agents see what was decided in prior turns and runs, preventing decision amnesia across handoffs.

### Mechanism 3: Coordinator Decision Ledger Writes

**Integration:** coordinator writes at 5 coordination events (init, dispatch, phase-transition, completion, recovery)
**Test suite:** `cli/test/coordinator-decision-ledger.test.js` (7 tests)

The coordinator automatically persists decisions at key lifecycle events, ensuring the trail captures governance actions not just agent decisions.

### Mechanism 4: Named Decisions in Reports/Dashboards

**Module:** `cli/src/lib/report.js` (decision rendering sections)
**Test suite:** `cli/test/named-decisions-visibility.test.js` (6 tests)

Governance reports render named decisions with per-repo breakdowns. Dashboard visibility ensures humans can inspect the decision trail through reports.

### Mechanism 5: Turn-Result Validator Decision Schema Enforcement

**Module:** `cli/src/lib/turn-result-validator.js` (decision validation in 5-stage pipeline)
**Test suite:** `cli/test/turn-result-validator.test.js` (100 tests)

Enforces DEC-NNN ID format, required category/statement/rationale fields, and challenge requirement (review-only roles must raise objections). Structurally prevents decision schema drift.

### Mechanism 6: Scope Overlap Guard

**Module:** `cli/src/lib/scope-overlap.js`
**Integration:** `cli/src/lib/intake.js:901`, `cli/src/lib/continuous-run.js:1329,1407,1493`
**Test suite:** `cli/test/scope-overlap.test.js` (12 tests)

Prevents conflicting decision chains by deferring overlapping intents at intake level. `--force-scope` provides operator override.

### Mechanism 7: No-Edit Review Normalization

**Module:** `cli/src/lib/turn-result-validator.js` (Rule 0a)
**Test suite:** `cli/test/bug-78-no-edit-review.test.js` (7 tests)

BUG-78 fix: auto-normalizes `workspace` → `review` for completed turns with empty `files_changed`. Preserves review decision audit trail integrity by ensuring review-only turns don't block the pipeline.

### Mechanism 8: Operator Decision CLI

**Module:** `cli/src/commands/decisions.js`
**Registration:** `cli/bin/agentxchain.js` (`agentxchain decisions`)
**Test suite:** within `repo-decisions.test.js` (2 tests)

`agentxchain decisions` with `--all` (include overridden), `--show` (detail view), `--json` (machine-readable) flags. Provides operators query access to the full decision trail.

### Dev Charter

**Verification-only.** Run the 8 test suites:

```bash
cd cli && npx vitest run test/repo-decisions.test.js test/dispatch-bundle-decision-history.test.js test/coordinator-decision-ledger.test.js test/named-decisions-visibility.test.js test/turn-result-validator.test.js test/scope-overlap.test.js test/bug-78-no-edit-review.test.js
```

Expected: ~194 tests, 0 failures.

After test verification, check off ROADMAP.md:149-157 (8 mechanism items + acceptance item).

### Architecture Invariants

1. No changes to any module — verification only
2. Decision ledger is append-only with override chains — never mutate existing entries
3. Turn-result validator enforces decision schema on every turn — no bypass path
4. Scope overlap guard runs at intake (before approval) — not at dispatch
5. Dispatch bundles always include full decision history — agents never lack decision context

## Acceptance Tests

All 8 test suites must pass:

| # | Mechanism | Test Suite | Expected Tests | Status |
|---|-----------|------------|----------------|--------|
| 1 | Decision Ledger | `repo-decisions.test.js` | 48 | Pending dev verification |
| 2 | Dispatch Bundle History | `dispatch-bundle-decision-history.test.js` | 12 | Pending dev verification |
| 3 | Coordinator Writes | `coordinator-decision-ledger.test.js` | 7 | Pending dev verification |
| 4 | Reports/Dashboards | `named-decisions-visibility.test.js` | 6 | Pending dev verification |
| 5 | Validator Schema | `turn-result-validator.test.js` | 100 | Pending dev verification |
| 6 | Scope Overlap | `scope-overlap.test.js` | 12 | Pending dev verification |
| 7 | Review Normalization | `bug-78-no-edit-review.test.js` | 7 | Pending dev verification |
| 8 | Operator CLI | within `repo-decisions.test.js` | 2 | Pending dev verification |

### Acceptance Criteria

| # | Criterion | Evidence Required |
|---|-----------|-------------------|
| AC-1 | All 8 test suites pass (~194 tests, 0 failures) | Dev test output |
| AC-2 | Each mechanism demonstrably addresses an aspect of "nobody owns the decision trail" | Dev confirms composition per PM_SIGNOFF.md table |
| AC-3 | ROADMAP.md:149-156 (8 mechanism items) checked off | Dev edit |
| AC-4 | ROADMAP.md:157 (acceptance item) checked off | Dev edit |
| AC-5 | Vision closure: VISION.md:49 "nobody owns the decision trail" addressed by composition | QA ship verdict |
