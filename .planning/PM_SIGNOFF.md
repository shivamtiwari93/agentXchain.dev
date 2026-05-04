# PM Signoff — Step Command Auto-Checkpoint After Acceptance

Approved: YES

**Run:** `run_8aceec319cd6aaed`
**Phase:** planning
**Turn:** `turn_0e31a4c2326e0d67`
**Date:** 2026-05-03

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain operators running governed turns via the `step` command, where PM→Dev or Dev→QA handoffs require a clean git workspace.

### Core Pain Point

The `step` command — the primary single-turn lifecycle command — accepts turns but does not commit the accepted files to git. This leaves the workspace dirty. The next `step` call fails at `assignGovernedTurn()` → `checkCleanBaseline()` with `checkpoint_required`, blocking the role handoff. Operators must manually run `accept-turn --checkpoint` or `checkpoint-turn` between every pair of `step` invocations.

**Direct evidence:** Commit `9c6c8bad1 baseline: commit PM planning artifacts for clean dev dispatch` is a manual workaround committed by the operator to unblock the dev turn after the PM turn was accepted but not checkpointed.

### Root Cause

`step.js` lines 992-1004 call `acceptGovernedTurn()` then `printAcceptSummary()` and exit. There is no call to `checkpointAcceptedTurn()`. The import for `turn-checkpoint.js` is absent entirely.

By contrast:
- `run.js` line 617: `afterAccept` callback calls `checkpointAcceptedTurn()` — continuous runs work correctly
- `accept-turn.js` line 177: `--checkpoint` flag calls `checkpointAcceptedTurn()` — manual checkpoint works correctly
- `continuous-run.js` line 2136: passes `autoCheckpoint` through to `executeGovernedRun()` — continuous mode works correctly

The gap is exclusively in the `step` command.

### Core Workflow

1. **PM (this turn)** — Charter dev with a bounded 2-change fix + 2-test scope
2. **Dev** — Adds auto-checkpoint to `step.js` after acceptance, adds integration test
3. **QA** — Verifies PM→Dev handoff via `step` works without manual git commit

### MVP Scope (this run)

**PM deliverables (this turn):**
1. PM_SIGNOFF.md: Feature planning with dev charter
2. SYSTEM_SPEC.md: Technical spec for the fix + test
3. ROADMAP.md: Phases table updated for this run

**Dev deliverables:**
1. `step.js`: Import `checkpointAcceptedTurn`, call it after successful acceptance, print checkpoint SHA/skip, add `--no-checkpoint` opt-out flag
2. Integration test: PM turn accepted → workspace auto-checkpointed → dev turn assigned without dirty-workspace error

### Out of Scope

- Changes to `run.js` auto-checkpoint (already works correctly)
- Changes to `accept-turn.js` checkpoint flag (already works correctly)
- Changes to `continuous-run.js` (already works correctly)
- Changes to `checkpointAcceptedTurn()` logic in `turn-checkpoint.js` (works correctly, just not wired into `step`)
- Making `accept-turn` default to checkpointing (separate enhancement, not this bug)
- Changes to `assignGovernedTurn()` clean-baseline check (correct behavior, should stay strict)

### Success Metric

| # | Acceptance Item | Verified By |
|---|----------------|-------------|
| 1 | PM→Dev handoff in continuous mode succeeds without manual git commit | Integration test: two consecutive `step` calls (PM then Dev) complete without dirty-workspace error |
| 2 | Checkpoint includes git commit of accepted files_changed | Test verifies `git log` contains checkpoint commit with turn metadata |
| 3 | Integration test: PM turn accepted, dev turn assigned without dirty-workspace error | New test in `cli/test/` exercises this exact flow |
| 4 | `--no-checkpoint` flag on `step` skips auto-checkpoint | Test verifies workspace stays dirty when flag is passed |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Auto-checkpoint fails silently, blocking next turn | Low | Print checkpoint error to console and exit non-zero (matching `accept-turn --checkpoint` behavior) |
| Review-only turns have no files to checkpoint | None | `checkpointAcceptedTurn()` already handles this (returns `skipped: true` for empty files_changed) |
| Operator wants to inspect workspace before checkpoint | Low | `--no-checkpoint` flag provides opt-out |

## Challenge to Previous Work

### OBJ-PM-001: Previous planning artifacts describe v2.155.73 release, not checkpoint-to-commit bug (severity: high)

PM_SIGNOFF.md, SYSTEM_SPEC.md, and ROADMAP.md Phases table all describe v2.155.73 release-bump workflow from a previous intent. This run's intent is: "Fix checkpoint to commit accepted planning artifacts to git." All three artifacts rewritten from scratch for the checkpoint-to-commit bug fix.

### OBJ-PM-002: Previous PM_SIGNOFF prescribed 14 release-alignment surface updates — zero of those apply here (severity: high)

The previous dev charter required updating 14 version-reference files and a CHANGELOG entry via `release-bump.sh`. This run's fix is 1 import + ~15 LOC in `step.js` + 1 integration test. Completely different scope.

## Notes for Dev

**Your charter is 2 changes: one code fix in `step.js`, one integration test. No changes to `turn-checkpoint.js`, `run.js`, or `continuous-run.js`.**

### Change 1: `cli/src/commands/step.js`

1. Add import: `import { checkpointAcceptedTurn } from '../lib/turn-checkpoint.js';`
2. After line 1004 (`printAcceptSummary(acceptResult, config);`), add auto-checkpoint:
   ```javascript
   if (!opts.noCheckpoint) {
     const checkpoint = checkpointAcceptedTurn(root, { turnId: turn.turn_id });
     if (!checkpoint.ok) {
       console.log(chalk.yellow(`  Checkpoint: accepted but checkpoint failed`));
       console.log(chalk.dim(`  Error: ${checkpoint.error}`));
       console.log(chalk.dim(`  Retry: agentxchain checkpoint-turn --turn ${turn.turn_id}`));
       process.exit(1);
     }
     if (!checkpoint.skipped) {
       console.log(`  ${chalk.dim('Checkpoint:')} ${checkpoint.checkpoint_sha}`);
     }
   }
   ```
3. Add CLI flag: `--no-checkpoint` option on the step command (check `cli/bin/agentxchain.js` for the step command definition)

### Change 2: Integration test

Add a test (new file or append to `cli/test/checkpoint-turn.test.js`) that exercises:
1. Set up governed project with PM role assigned
2. Simulate PM turn completion (write staged result with `files_changed` pointing to real files)
3. Run `step` (or equivalent test harness) — accept + auto-checkpoint
4. Verify git log contains checkpoint commit
5. Assign dev turn — verify no `checkpoint_required` error

## Notes for QA

- Verify `step.js` imports `checkpointAcceptedTurn` and calls it after acceptance
- Verify `--no-checkpoint` flag is registered and respected
- Verify the integration test exercises the full PM→Dev handoff
- Run full test suite: `cd cli && npm test`
- After ship: verify the acceptance contract items from the intake intent

## Acceptance Contract

1. **PM→Dev handoff in continuous mode succeeds without manual git commit** — `step` auto-checkpoints after acceptance, no manual `checkpoint-turn` or git commit needed between turns
2. **Checkpoint includes git commit of accepted files_changed** — `checkpointAcceptedTurn()` already implements this, now wired into `step`
3. **Integration test: PM turn accepted, dev turn assigned without dirty-workspace error** — new test exercises this exact flow
