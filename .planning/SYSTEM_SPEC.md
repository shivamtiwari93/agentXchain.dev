# System Spec — M12: Quality Drift Prevention — Vision Closure (VISION.md:33)

**Run:** `run_08c9a1482479ae2e`
**Baseline:** git:540aca491 (latest checkpoint)

## Purpose

This run formally closes the VISION.md:33 goal "quality drifts" by verifying that 8 delivered mechanisms across milestones MW and M1 collectively prevent quality drift in multi-agent governed delivery.

"Quality drifts" is a cross-cutting concern — no single module or milestone addresses it alone. Instead, it is addressed by the composition of: structural turn validation, workflow gate semantics, phase gate enforcement, mandatory challenge, release alignment, acceptance matrix enforcement, release notes enforcement, and end-to-end pipeline proof.

This is a verification-only run. No new code changes are expected.

## Interface

### Mechanism 1: Turn-Result Validator (5-Stage Pipeline) — `cli/src/lib/turn-result-validator.js`

5-stage validation pipeline enforces structural quality on every turn result:
- **Stage A** (line 178): Schema validation — enforces required fields, correct types, enum values
- **Stage B** (line 638): Assignment validation — verifies run_id, turn_id, role, runtime_id match dispatch
- **Stage C** (line 671): Artifact validation — verifies artifact type matches files_changed, write authority
- **Stage D** (line 806): Verification validation — ensures machine_evidence exit codes support verification status
- **Stage E** (line 966): Protocol compliance — challenge requirement, routing legality, phase transitions

**How it prevents quality drift:** Every turn output must pass all 5 stages before acceptance. An agent cannot submit a malformed, incomplete, or structurally invalid result. Quality enforcement is at the turn boundary, not advisory.

### Mechanism 2: Workflow Gate Semantics — `cli/src/lib/workflow-gate-semantics.js`

6 semantic evaluators enforce content quality on governed artifacts:

```javascript
evaluatePmSignoff(content)          // Requires "Approved: YES" declaration
evaluateSystemSpec(content)          // Requires Purpose, Interface, Acceptance Tests sections
evaluateImplementationNotes(content) // Requires Changes and Verification sections with real content
evaluateAcceptanceMatrix(content)    // Requires | Req # | table with all-passing rows
evaluateShipVerdict(content)         // Requires explicit YES/NO verdict
evaluateReleaseNotes(content)        // Requires User Impact and Verification Summary sections
```

Exported via `SEMANTIC_EVALUATORS` map (line 447) and `evaluateSemantic()` dispatcher (line 481).

**How it prevents quality drift:** Each governed artifact has a structural quality contract. Placeholder text is rejected. Missing sections are rejected. Non-passing acceptance rows are rejected. Quality requirements are enforced by machine, not by convention.

### Mechanism 3: Phase Gate Enforcement — `cli/src/lib/governed-state.js`

Phase transitions require all gate files to exist and pass semantic validation:
- **planning → implementation**: PM_SIGNOFF.md + SYSTEM_SPEC.md + ROADMAP.md
- **implementation → QA**: IMPLEMENTATION_NOTES.md
- **QA → ship**: acceptance-matrix.md + ship-verdict.md

**How it prevents quality drift:** Phases cannot advance without completing quality checkpoints. An agent cannot skip planning and jump to implementation, or skip QA and ship directly.

### Mechanism 4: Challenge Requirement — `cli/src/lib/turn-result-validator.js:976`

```javascript
// Challenge requirement: review_only roles MUST raise at least one objection
```

Review-only roles (typically dev-in-planning-review, qa-in-review) must include at least one objection in their turn result. The validator rejects turn results from review-only roles with empty objections arrays.

**How it prevents quality drift:** Forces active quality evaluation. Rubber-stamping is structurally impossible for review roles — the pipeline rejects turn results that don't challenge prior work.

### Mechanism 5: Release Alignment (8-Dimension Validation) — `cli/src/lib/release-alignment.js`

```javascript
export function validateReleaseAlignment(repoRoot, { targetVersion, scope })
  // → { aligned, dimensions: Array<{ name, status, details }> }
export function getReleaseAlignmentContext(repoRoot, { targetVersion })
  // → { version, changelog, docs, tests, ... }
```

Validates release readiness across 8 dimensions: documentation, version consistency, test coverage, CI status, changelog, installation, configuration, and compatibility.

**How it prevents quality drift:** Release quality is not a subjective assessment — it is an 8-dimension structured validation. Drift in any dimension is detected and reported.

### Mechanism 6: Acceptance Matrix Enforcement — `cli/src/lib/workflow-gate-semantics.js:117`

`evaluateAcceptanceMatrix()` enforces:
- `| Req # |` table header must be present (line 119)
- At least one real requirement row (not placeholder text)
- Every requirement row must have an affirmative status (PASS, PASSED, OK, YES)
- Non-passing rows cause gate failure with specific error listing which rows failed

**How it prevents quality drift:** QA cannot ship with vague or incomplete acceptance evidence. Every acceptance criterion must be explicitly evaluated and marked passing.

### Mechanism 7: Release Notes Enforcement — `cli/src/lib/workflow-gate-semantics.js:258`

`evaluateReleaseNotes()` enforces:
- `## User Impact` section must exist with real content (line 259)
- `## Verification Summary` section must exist with real content (line 260)
- Placeholder text "(QA fills this during the QA phase)" is rejected (line 238)

**How it prevents quality drift:** Release documentation quality is structurally enforced. An agent cannot ship with template placeholders or missing documentation.

### Mechanism 8: No-Edit Review Normalization (BUG-78) — `cli/src/lib/turn-result-validator.js`

Rule 0a (line 1527) normalizes artifact type from `workspace` to `review` for completed turns with empty `files_changed`. This prevents the pipeline from blocking on valid review turns that made no code changes.

**How it prevents quality drift:** Ensures the quality enforcement pipeline itself doesn't create false positives that force agents to circumvent validation. A well-functioning quality system must not reject legitimate work patterns.

### Dev Charter

**Verification-only.** Re-run all 8 quality-enforcement test suites to confirm the quality-drift prevention infrastructure is intact:

```bash
cd cli && npx vitest run test/turn-result-validator.test.js             # 100 tests
cd cli && npx vitest run test/gate-evaluator.test.js                    # 52 tests
cd cli && npx vitest run test/implementation-gate.test.js               # 10 tests
cd cli && npx vitest run test/release-notes-gate.test.js                # 10 tests
cd cli && npx vitest run test/workflow-gate-placeholder-leak.test.js    # 8 tests
cd cli && npx vitest run test/bug-78-no-edit-review.test.js             # 7 tests
cd cli && npx vitest run test/release-alignment.test.js                 # 6 tests
cd cli && npx vitest run test/e2e-release-gate.test.js                  # 4 tests
```

Expected: 197 tests, 0 failures. No new code changes expected.

Spot-check key exports exist in `workflow-gate-semantics.js`, `turn-result-validator.js`, and `release-alignment.js`.

### Architecture Invariants

1. No changes to any mechanism module — verification only
2. Turn-result validation is 5-stage and mandatory — no bypass path exists
3. Workflow gate semantics reject placeholder text — real content required
4. Phase gates are enforced by governed-state.js, not by convention
5. Challenge requirement is enforced at the validator level (line 976), not advisory

## Acceptance Tests

All 197 tests across 8 suites must pass:

| # | Suite | Test Count | Mechanism | Status |
|---|-------|-----------|-----------|--------|
| 1 | `turn-result-validator.test.js` | 100 | 5-stage turn validation pipeline | Passing (PM verified) |
| 2 | `gate-evaluator.test.js` | 52 | Gate evaluation + semantic dispatch | Passing (PM verified) |
| 3 | `implementation-gate.test.js` | 10 | Implementation phase gate enforcement | Passing (PM verified) |
| 4 | `release-notes-gate.test.js` | 10 | Release notes quality enforcement | Passing (PM verified) |
| 5 | `workflow-gate-placeholder-leak.test.js` | 8 | Placeholder text rejection | Passing (PM verified) |
| 6 | `bug-78-no-edit-review.test.js` | 7 | No-edit review normalization | Passing (PM verified) |
| 7 | `release-alignment.test.js` | 6 | 8-dimension release validation | Passing (PM verified) |
| 8 | `e2e-release-gate.test.js` | 4 | Full pipeline proof | Passing (PM verified) |
| | **Total** | **197** | | **All passing** |

### Acceptance Criteria

| # | Criterion | Evidence Required |
|---|-----------|-------------------|
| AC-1 | All 197 quality-enforcement tests pass | Dev test output showing 197/197, 0 failures |
| AC-2 | `workflow-gate-semantics.js` exports 6 semantic evaluators | Dev grep/spot-check |
| AC-3 | `turn-result-validator.js` enforces 5-stage pipeline (A–E) | Dev grep confirmation |
| AC-4 | `turn-result-validator.js` enforces challenge requirement (line 976) | Dev grep confirmation |
| AC-5 | `release-alignment.js` exports `validateReleaseAlignment` and `getReleaseAlignmentContext` | Dev grep/spot-check |
| AC-6 | Phase gates prevent skipping quality steps (planning → impl → QA) | Dev confirmation of governed-state.js enforcement |
| AC-7 | ROADMAP.md M12 milestone documented with mechanism evidence | PM artifact (this turn) |
| AC-8 | Vision goal "quality drifts" addressed by composition | QA assessment of 8-mechanism coverage |
