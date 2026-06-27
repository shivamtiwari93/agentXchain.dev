# Acceptance Matrix — M13: Decision Trail Ownership — Vision Closure (VISION.md:34)

**Run:** run_4793c2273d675dd9
**Turn:** turn_bab59d2ad8d0e45e (QA)
**Scope:** Verify 8 decision trail mechanisms compose to address VISION.md:49 "nobody owns the decision trail" — 196 tests, 0 failures, ROADMAP.md:149-157 closed

## Section A: SYSTEM_SPEC Acceptance Criteria

| Req # | Criterion | Evidence | Status |
|-------|-----------|----------|--------|
| AC-1 | All 8 test suites pass (~194 tests, 0 failures) | QA independently ran all 7 test files: 196 tests, 0 failures (8.32s). Exceeds SYSTEM_SPEC's ~194 baseline by 2 (AT-DT-CLI-001 added by dev + pre-existing undercounts in turn-result-validator and bug-78 suites). | PASS |
| AC-2 | Each mechanism demonstrably addresses an aspect of "nobody owns the decision trail" | QA verified composition table below — all 8 mechanisms map to distinct ownership aspects (persistence, visibility, enforcement, integrity, access). | PASS |
| AC-3 | ROADMAP.md:149-156 (8 mechanism items) checked off | QA confirmed: all 8 items marked `[x]` with run references to `run_4793c2273d675dd9`. | PASS |
| AC-4 | ROADMAP.md:157 (acceptance item) checked off | QA confirmed: line 157 reads `[x] Acceptance: all 8 mechanisms verified...196 tests, 0 failures` with run reference. | PASS |
| AC-5 | Vision closure: VISION.md:49 "nobody owns the decision trail" addressed by composition | QA confirms: the 8 mechanisms collectively provide persistence (#1), agent visibility (#2), automatic capture (#3), human visibility (#4), structural enforcement (#5), conflict integrity (#6), audit trail integrity (#7), and operator query access (#8). This is a complete composition. | PASS |

**Acceptance: 5/5 PASS**

## Section B: Dev Decision Verification

### DEC-001 (AT-DT-CLI-001 closes untested --show not-found error path in decisions.js:32-36): VERIFIED

QA independently confirmed:
1. `decisions.js:32` — `const dec = getRepoDecisionById(root, opts.show);`
2. `decisions.js:33-35` — `if (!dec) { console.error(chalk.red(\`Decision ${opts.show} not found\`)); process.exit(1); }`
3. AT-DT-CLI-001 (test line 672) exercises this by calling `--show DEC-999` when only DEC-001 exists
4. Assertions verify: command throws with non-zero exit, stderr matches `/DEC-999 not found/`
5. Test uses proper cleanup pattern (tmpRoot with rmSync in finally block)

### DEC-002 (PM test count claims corrected): VERIFIED WITH FINDING

Dev claimed "actual vitest counts are 49/12/7/6/102/12/8/8 = 196." The per-file counts are correct (49+12+7+6+102+12+8 = 196), but listing 8 numbers that sum to 204 is misleading — the mechanism #8 count (8) is a subset of mechanism #1's file (49). The correct notation is 7 unique files = 196 total tests, with the 8 mechanism-8 CLI tests being a subset of repo-decisions.test.js's 49. Non-blocking documentation inaccuracy.

### DEC-003 (Composition verified — 8 mechanisms collectively address VISION.md:49): VERIFIED

QA independently confirmed each mechanism maps to a distinct ownership dimension. See Section D.

## Section C: Architecture Invariants

| Invariant | Evidence | Status |
|-----------|----------|--------|
| No changes to any source module in this run | Dev modified only `cli/test/repo-decisions.test.js` (1 test added) and `.planning/` artifacts — no source module changes | PASS |
| Decision ledger is append-only with override chains | `appendRepoDecision` appends to `.agentxchain/decision-ledger.jsonl`; overrides create new entries with `overrides`/`overridden_by` fields | PASS |
| Turn-result validator enforces decision schema on every turn | `turn-result-validator.js` 5-stage pipeline validates DEC-NNN IDs, required fields, challenge requirement — 102 tests confirm | PASS |
| Scope overlap guard runs at intake (before approval) | `intake.js:901` scope_overlap_detected guard in `approveIntent()`, before run initialization | PASS |
| Dispatch bundles always include full decision history | `dispatch-bundle.js:~1416` Decision History section, `dispatch-bundle.js:~775` repo decisions context — 12 tests confirm | PASS |

**Invariants: 5/5 PASS**

## Section D: Composition Verification (VISION.md:49)

| # | Mechanism | Ownership Dimension | How It Addresses "nobody owns the decision trail" | Tests | Status |
|---|-----------|--------------------|----------------------------------------------------|-------|--------|
| 1 | Decision Ledger | Persistence | Cross-run persistent storage in `.agentxchain/decision-ledger.jsonl` with 12 CRUD+query exports. Decisions survive across runs. | 49 | PASS |
| 2 | Dispatch Bundle History | Agent Visibility | Every dispatched turn receives full decision history table in context bundle. Agents see prior decisions, preventing amnesia. | 12 | PASS |
| 3 | Coordinator Writes | Automatic Capture | Coordinator writes at 5 lifecycle events (init, dispatch, phase-transition, completion, recovery). Trail captures governance actions. | 7 | PASS |
| 4 | Reports/Dashboards | Human Visibility | Named decisions rendered in governance reports with per-repo breakdowns. Operators inspect trail through reports. | 6 | PASS |
| 5 | Turn-Result Validator | Enforcement | DEC-NNN ID format, required category/statement/rationale, challenge requirement. Structurally prevents schema drift. | 102 | PASS |
| 6 | Scope Overlap Guard | Conflict Integrity | Prevents conflicting decision chains by deferring overlapping intents at intake level. `--force-scope` provides override. | 12 | PASS |
| 7 | No-Edit Review Normalization | Audit Trail Integrity | BUG-78 Rule 0a preserves review decision audit trail by auto-normalizing workspace→review for completed empty turns. | 8 | PASS |
| 8 | Operator Decision CLI | Query Access | `agentxchain decisions` with `--all`, `--show`, `--json` flags. Operators can query the full trail. | 8* | PASS |

*Mechanism #8 tests are within `repo-decisions.test.js` (8 of the 49 total). Unique test file total: 7 files, 196 tests.

**Composition: 8/8 mechanisms verified. VISION.md:49 "nobody owns the decision trail" is addressed.**

## Section E: Regression Results (QA-Verified)

| Suite | Tests | Result | Exit Code |
|-------|-------|--------|-----------|
| repo-decisions.test.js | 49 | PASS | 0 |
| turn-result-validator.test.js | 102 | PASS | 0 |
| dispatch-bundle-decision-history.test.js | 12 | PASS | 0 |
| scope-overlap.test.js | 12 | PASS | 0 |
| bug-78-no-edit-review.test.js | 8 | PASS | 0 |
| coordinator-decision-ledger.test.js | 7 | PASS | 0 |
| named-decisions-visibility.test.js | 6 | PASS | 0 |
| **Total** | **196** | **0 failures** | **0** |

All suites run by QA via `npx vitest run` with exit code 0.

## Section F: QA Findings

### Finding 1 (blocking, fixed): Stale QA artifacts from wrong run — 8th consecutive occurrence

All three QA workflow artifacts (acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) referenced `run_71c0a7eaf361090b` (BUG-FIX: Step Auto-Checkpoint) instead of current `run_4793c2273d675dd9` (M13: Decision Trail Ownership). This is the **eighth** consecutive run where this pattern has occurred. All three rewritten from scratch by this QA turn.

### Finding 2 (non-blocking): Dev test count notation misleading

Dev DEC-002 states "actual vitest counts are 49/12/7/6/102/12/8/8 = 196" — but those 8 numbers sum to 204, not 196. The mechanism #8 count (8) is a subset of mechanism #1's file (49). Correct notation: 7 unique files totaling 196 tests, with mechanism #8's 8 tests being a subset of repo-decisions.test.js. The total 196 is correct; the per-mechanism breakdown double-counts.

### Finding 3 (non-blocking): SYSTEM_SPEC mechanism #8 test count was wrong

SYSTEM_SPEC line 82 claimed mechanism #8 has "2 tests." Actual count in the `decisions CLI command` describe block: 8 tests (7 original + 1 AT-DT-CLI-001). PM undercount by 6.

### Finding 4 (non-blocking): ROADMAP.md Phases table QA row stale

ROADMAP.md:165 still says "Verify 194 tests pass" and "Pending" — should be 196 tests. Updated by QA.
