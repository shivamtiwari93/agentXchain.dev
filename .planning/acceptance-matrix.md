# Acceptance Matrix — BUG-FIX: Step Auto-Checkpoint Acceptance Closure

**Run:** run_71c0a7eaf361090b
**Turn:** turn_31528db7b18ee395 (QA)
**Scope:** Verify step auto-checkpoint acceptance criterion (ROADMAP.md:70) — PM→Dev handoff via consecutive `step` calls succeeds without manual git commit

## Section A: SYSTEM_SPEC Acceptance Criteria

| Req # | Criterion | Evidence | Status |
|-------|-----------|----------|--------|
| AC-1 | All step-auto-checkpoint tests pass (0 failures) | QA ran `npx vitest run test/step-auto-checkpoint.test.js`: 4/4 pass, exit code 0. Exceeds SYSTEM_SPEC's 3-test baseline by 1 (AT-STEP-CKPT-004 added by dev). | PASS |
| AC-2 | AT-STEP-CKPT-001 proves PM→Dev handoff without manual git commit | QA reviewed AT-STEP-CKPT-001 (test lines 229-269): assigns PM turn → writes `.planning/PM_SIGNOFF.md` → `step --resume` accepts and auto-checkpoints → verifies checkpoint commit in git log → verifies `checkpoint_sha` in state and history → assigns dev turn without dirty-workspace error. This IS the acceptance criterion flow. | PASS |
| AC-3 | ROADMAP.md:70 checked off | QA confirmed: `.planning/ROADMAP.md:70` reads `- [x] Acceptance: PM→Dev handoff via consecutive \`step\` calls succeeds without manual git commit` with run reference `run_71c0a7eaf361090b`. | PASS |
| AC-4 | Acceptance contract: PM→Dev handoff via consecutive `step` calls succeeds without manual git commit | AT-STEP-CKPT-001 directly demonstrates this. The test creates a PM turn with file changes, runs `step --resume`, verifies auto-checkpoint creates a git commit, then successfully assigns a dev turn — no manual `git add && git commit` between steps. Ship verdict YES. | PASS |

**Acceptance: 4/4 PASS**

## Section B: Dev Decision Verification

### DEC-001 (AT-STEP-CKPT-004 closes last untested branch in step.js auto-checkpoint): VERIFIED

QA independently confirmed:
1. `step.js:1017` — `if (!checkpoint.skipped)` is the branch under test
2. `turn-checkpoint.js:402-408` — returns `{ ok: true, skipped: true }` when `filesChanged.length === 0`
3. AT-STEP-CKPT-004 (test lines 348-406) exercises this by setting `artifact.type: 'review'` and `files_changed: []`
4. Assertions verify: turn accepted in history, no `checkpoint_sha`, no checkpoint commit in git log, `last_completed_turn_id` matches

### DEC-002 (IMPLEMENTATION_NOTES.md rewritten for current run): VERIFIED

IMPLEMENTATION_NOTES.md references `run_71c0a7eaf361090b` and correctly describes AT-STEP-CKPT-004's purpose, scenario, and assertions. Matches the actual test code.

## Section C: Architecture Invariants

| Invariant | Evidence | Status |
|-----------|----------|--------|
| Auto-checkpoint runs after acceptance, never before | `step.js:1005` prints accept summary, then line 1007 starts checkpoint block. Acceptance at line 995 is durable. | PASS |
| Checkpoint stages only declared `files_changed` | `turn-checkpoint.js:412` uses `git add -A -- ...filesChanged`, not `git add -A` on whole workspace | PASS |
| `--no-checkpoint` is opt-out, not opt-in | `step.js:1008` checks `!opts.noCheckpoint` — default behavior is to checkpoint | PASS |
| Checkpoint failure produces retry command, not silent failure | `step.js:1011-1015` prints error and retry command, exits with code 1 | PASS |
| No source module changes in this run | Dev modified only `cli/test/step-auto-checkpoint.test.js` and `.planning/IMPLEMENTATION_NOTES.md` — test-only addition | PASS |

**Invariants: 5/5 PASS**

## Section D: Regression Results (QA-Verified)

| Suite | Tests | Result | Exit Code |
|-------|-------|--------|-----------|
| step-auto-checkpoint.test.js | 4 | PASS | 0 |
| checkpoint-turn.test.js | 12 | PASS | 0 |
| turn-result-validator.test.js | 102 | PASS | 0 |
| gate-evaluator.test.js | 52 | PASS | 0 |
| implementation-gate.test.js | 10 | PASS | 0 |
| **Total** | **180** | **0 failures** | **0** |

All suites run by QA via `npx vitest run` invocations.

## Section E: QA Findings

### Finding 1 (blocking, fixed): Stale QA artifacts from wrong run — 7th consecutive occurrence

All three QA workflow artifacts (acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) referenced `run_08c9a1482479ae2e` (M12: Quality Drift Prevention) instead of current `run_71c0a7eaf361090b` (Step Auto-Checkpoint Acceptance). This is the **seventh** consecutive run where this pattern has occurred. All three rewritten from scratch by this QA turn.

### Finding 2 (non-blocking): SYSTEM_SPEC pseudo-code differs from actual code

SYSTEM_SPEC.md lines 23-35 show an `await` call with different parameters (`checkpointAcceptedTurn(root, config, {...})`). Actual code at `step.js:1009` is synchronous with signature `checkpointAcceptedTurn(root, { turnId: turn.turn_id })`. PM-authored spec documentation inaccuracy. Non-blocking — the code is correct and tested.

### Finding 3 (non-blocking): Dev deviated from PM "verification-only" charter

PM DEC-003 scoped this as "test-run + roadmap-check — no new code expected." Dev added AT-STEP-CKPT-004 to satisfy the implementation-phase product-code guard (turn-result-validator.js:733-739). This is the sixth recurrence of this PM/dev friction pattern. The test covers a genuine untested branch (`checkpoint.skipped` at step.js:1017) and is a net positive.

### Finding 4 (non-blocking): SYSTEM_SPEC expected 3 tests, dev delivered 4

SYSTEM_SPEC says "Expected: 3 tests, 0 failures." Dev added a 4th test. This improves branch coverage — not a defect.
