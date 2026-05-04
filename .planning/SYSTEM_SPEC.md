# System Spec — M11: Assumption Divergence Governance (Vision Closure)

**Run:** `run_a413eee8dd1891c7`
**Baseline:** git:e1cbfb7a7 (latest checkpoint)

## Purpose

This run formally closes the VISION.md:32 goal "assumptions diverge" by verifying that 7 delivered mechanisms across milestones M1, M3, M10, and MW collectively prevent assumption divergence in multi-agent governed delivery.

"Assumptions diverge" is a cross-cutting concern — no single module or milestone addresses it alone. Instead, it is addressed by the composition of: decision recording, cross-run persistence, dispatch-time visibility, authority-gated overrides, mandatory challenge, scope deconfliction, and structured workflow artifacts.

This is a verification-only run. No new code changes are expected.

## Interface

### Mechanism 1: Decision Ledger — `cli/src/lib/repo-decisions.js`

```javascript
export function readRepoDecisions(root)              // → Array<decision>
export function getActiveRepoDecisions(root)          // → Array<decision> (status === 'active')
export function appendRepoDecision(root, entry)       // → void (writes to repo-decisions.jsonl)
export function overrideRepoDecision(root, targetId, overridingId) // → void (marks target overridden)
export function validateOverride(root, decision, config) // → { valid, error? }
export function checkOverrideAuthority(decision, target, config) // → { allowed, reason }
```

**How it prevents divergence:** Every decision is durably recorded. Decisions with `durability: "repo"` persist across runs. Override authority is role-gated — agents cannot silently contradict prior decisions.

### Mechanism 2: Decision History in Dispatch Bundles — `cli/src/lib/dispatch-bundle.js`

Renders `## Decision History` section (line 1416) in CONTEXT.md with the last 50 agent decisions as a markdown table. Also renders active repo decisions section (line 775) when `state.repo_decisions` is non-empty.

**How it prevents divergence:** Every agent sees all prior decisions before acting. Assumptions are visible, not implicit.

### Mechanism 3: Coordinator Decision Ledger — `cli/src/lib/governed-state.js`

The orchestrator itself writes structured decisions at key coordination events: initialization, dispatch, phase transition, completion, and recovery (tested in `coordinator-decision-ledger.test.js`).

**How it prevents divergence:** Even system-level coordination assumptions are recorded, not just agent-level decisions.

### Mechanism 4: Named Decisions Visibility — `cli/src/lib/repo-decisions.js`

Reports and dashboards render per-repo decision breakdowns with `required_decision_ids_by_repo` and `satisfied_decision_ids_by_repo` fields (tested in `named-decisions-visibility.test.js`).

**How it prevents divergence:** Decision requirements are surfaced in governance reports so operators can verify assumption alignment.

### Mechanism 5: Turn-Result Validator — `cli/src/lib/turn-result-validator.js`

5-stage validation pipeline enforces decision schema (DEC-NNN IDs, category enum, non-empty statement+rationale). Line 976: review-only roles MUST raise at least one objection — this forces cross-agent challenge of prior assumptions.

**How it prevents divergence:** Structural enforcement ensures decisions are well-formed, and the challenge requirement ensures at least one agent formally evaluates prior assumptions per run.

### Mechanism 6: Scope Overlap Guard — `cli/src/lib/scope-overlap.js`

```javascript
export function extractScopeFingerprint(text)     // → Set<string>
export function computeScopeOverlap(a, b)          // → number (0.0–1.0 Jaccard)
export function checkIntentScopeOverlap(root, charter, acceptanceContract, options)
  // → { overlapping, matches, max_score }
```

Integrated at `intake.js:901` and `continuous-run.js:1329,1407,1493`. CLI override: `--force-scope`.

**How it prevents divergence:** Prevents the continuous loop from spawning runs whose scope overlaps recently completed work, stopping conflicting assumptions at the intake level before agents even begin work.

### Mechanism 7: Workflow Kit — `cli/src/lib/workflow-gate-semantics.js`

SYSTEM_SPEC.md, PM_SIGNOFF.md, IMPLEMENTATION_NOTES.md, acceptance-matrix.md, and ship-verdict.md enforce structured documentation of assumptions per phase. The BUG-78 fix (Rule 0a normalization) ensures no-edit review turns don't block the pipeline.

**How it prevents divergence:** Assumptions are written into governed artifacts (specs, signoffs, acceptance matrices) rather than existing only in agent context windows. Every subsequent agent reads the spec before implementing.

### Dev Charter

**Verification-only.** Re-run all 7 mechanism test suites to confirm the assumption-governance infrastructure is intact:

```bash
cd cli && npx vitest run test/repo-decisions.test.js                    # 39 tests
cd cli && npx vitest run test/dispatch-bundle-decision-history.test.js  # 12 tests
cd cli && npx vitest run test/coordinator-decision-ledger.test.js       # 7 tests
cd cli && npx vitest run test/named-decisions-visibility.test.js        # 6 tests
cd cli && npx vitest run test/scope-overlap.test.js                     # 12 tests
cd cli && npx vitest run test/turn-result-validator.test.js             # 100 tests
cd cli && npx vitest run test/bug-78-no-edit-review.test.js             # 7 tests
```

Expected: 183 tests, 0 failures. No new code changes expected.

Spot-check key exports exist in `repo-decisions.js`, `scope-overlap.js`, and `dispatch-bundle.js`.

### Architecture Invariants

1. No changes to any mechanism module — verification only
2. Decision ledger is append-only with monotonic IDs
3. Override authority is role-gated, never bypassed
4. Scope overlap is deferring, not blocking — `--force-scope` overrides
5. Challenge requirement is enforced at the validator level, not advisory

## Acceptance Tests

All 183 tests across 7 suites must pass:

| # | Suite | Test Count | Mechanism | Status |
|---|-------|-----------|-----------|--------|
| 1 | `repo-decisions.test.js` | 39 | Decision ledger + override authority | Passing (PM verified) |
| 2 | `dispatch-bundle-decision-history.test.js` | 12 | Decision visibility in dispatch | Passing (PM verified) |
| 3 | `coordinator-decision-ledger.test.js` | 7 | Coordinator-level decision writes | Passing (PM verified) |
| 4 | `named-decisions-visibility.test.js` | 6 | Decision visibility in reports | Passing (PM verified) |
| 5 | `scope-overlap.test.js` | 12 | Scope deconfliction | Passing (PM verified) |
| 6 | `turn-result-validator.test.js` | 100 | Decision schema + challenge req | Passing (PM verified) |
| 7 | `bug-78-no-edit-review.test.js` | 7 | No-edit review normalization | Passing (PM verified) |
| | **Total** | **183** | | **All passing** |

### Acceptance Criteria

| # | Criterion | Evidence Required |
|---|-----------|-------------------|
| AC-1 | All 183 mechanism tests pass | Dev test output showing 183/183, 0 failures |
| AC-2 | `repo-decisions.js` exports 6 governance functions | Dev grep/spot-check |
| AC-3 | `dispatch-bundle.js` renders Decision History section | Dev grep confirmation |
| AC-4 | `scope-overlap.js` exports 3 deconfliction functions | Dev grep/spot-check |
| AC-5 | `turn-result-validator.js` enforces challenge requirement (line 976) | Dev grep confirmation |
| AC-6 | ROADMAP.md M11 milestone documented with mechanism evidence | PM artifact (this turn) |
| AC-7 | Vision goal "assumptions diverge" addressed by composition | QA assessment of 7-mechanism coverage |
