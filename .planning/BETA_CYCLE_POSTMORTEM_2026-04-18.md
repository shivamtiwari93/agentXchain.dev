# Beta Cycle Postmortem — 2026-04-18

> Private internal document. Not for public surfaces.

## Summary

Between v2.130.1 and v2.137.0, the same class of bug — stale/legacy/phantom intents breaking continuous startup — was falsely closed **seven times**. Each closure shipped with passing tests. Each was reopened when the beta tester ran the fix against their actual repo and hit the same failure.

The root cause is not a single code defect. The root cause is a **testing pattern failure**: tester-sequence tests exercised a clean fixture path that the tester's real repo was never on.

## The Seven False Closures

### 1–4. BUG-17/19/20/21 → v2.130.1

**What was claimed fixed:** Multiple intake/validation/acceptance bugs affecting continuous mode.

**Why it was false:** Tests ran against fresh governed repos with clean state. The tester's repo had accumulated state from prior CLI versions — pre-existing intent files, session files with stale flags, state.json from earlier run lifecycles. Tests passed on the clean path; the real path still broke.

**Pattern:** Clean fixture ≠ production state.

### 5. BUG-36 → v2.135.0

**What was claimed fixed:** Cross-run intent scoping. Legacy intents from prior runs were being picked up by the current run's queue selection.

**Why it was false:** The test seeded fresh intents with correct `approved_run_id: null` and proved migration archived them. The tester's repo had intents that had been through multiple CLI versions — some with `approved_run_id: null`, some partially migrated by earlier code, some with stale `run_id` values. The test covered one state; the tester had three.

**Pattern:** Single-state fixture ≠ accumulated multi-version state.

### 6. BUG-39 → v2.135.1

**What was claimed fixed:** Pre-BUG-34 legacy intents with `approved_run_id: null` should be archived, not silently adopted into the current run.

**Why it was false:** The fix was correct for the null-scoped case. But the tester had already run a prior version that attempted migration and set `startup_reconciled_run_id` in the session file. The BUG-39 test did not seed a pre-existing session file with that flag already set. Migration was guarded behind `startup_reconciled_run_id !== scopedRunId`, so the correct migration code never ran.

**Pattern:** Session-flag guard created a stale-lock. Test didn't seed the stale session.

### 7. BUG-40/41 → v2.136.0/v2.137.0

**What was claimed fixed (BUG-40):** Startup migration shared across all paths via `intent-startup-migration.js`. All startup paths call `archiveStaleIntentsForRun()`.

**Why BUG-40 was false:** Same session-flag stale-lock as BUG-39. The test seeded legacy intents but not a pre-existing session with `startup_reconciled_run_id` already set.

**What was claimed fixed (BUG-41):** Removed the session-flag guard entirely. Migration always runs from actual on-disk intent state.

**Why BUG-41 was false:** The tester's intents were no longer null-scoped. Some earlier code path (`approveIntent()` in `intake.js:795`, commit `b3ed09dee`) had rebound them to `approved_run_id: run_c8a4701ce0d4952d`. They now looked like valid current-run intents. Migration correctly said "No legacy intents found." But the intents were phantom — their planning work was already done, so continuous mode tried to re-plan and hit "existing planning artifacts would be overwritten."

**Pattern:** The bug class evolved from "null-scoped intents" to "phantom intents" (approved intents whose acceptance contract is already satisfied). Each fix addressed the previous manifestation, not the underlying class.

## The Failure Pattern

Every false closure shares the same structure:

1. **Bug reported** with specific tester state (on-disk files, session flags, accumulated history).
2. **Fix written** targeting the identified code path.
3. **Test written** against a synthetic fixture that exercises the fix.
4. **Test passes.** Code is correct for the fixture's state.
5. **Release shipped** with "reproduces-on-tester-sequence: NO."
6. **Tester runs the fix** against their actual repo, which has different accumulated state.
7. **Same symptom reappears** — different root cause, same failure mode.

The common thread: **the test seeded a clean approximation of the tester's state, not the actual state.** Every fixture was "close enough" to feel like proof but different enough to miss the real trigger.

## Why Helper-Level Tests Kept Lying

The tester-sequence tests called migration helpers directly (`migratePreBug34Intents()`, `archiveStaleIntentsForRun()`) with seeded state and asserted the helper's return value. This proved the helper was correct. It did not prove the CLI command exercised the helper correctly, or that the helper was called at all on the real startup path.

Turn 220 (GPT 5.4) added the first exact-command test — running `run --continue-from ... --continuous --auto-checkpoint` and asserting output. It immediately found that the phantom detector missed the `generic` template's planning-gate artifacts. The helper test passed; the command test failed. That is the gap.

**Lesson:** Helper-level tests prove the helper works. Command-level tests prove the product works. Only command-level tests are closure evidence.

## Why Discipline Rules 1–11 Were Insufficient

The discipline rules correctly identified the problem class (clean fixtures, missing regression tests, overclaimed closures). They did not enforce the solution:

- **Rule 1** ("live end-to-end repro") was satisfied by running the test suite, not by running the tester's exact command.
- **Rule 6** ("reproduces-on-tester-sequence: NO") was written after running helper-level tests, not after running the CLI command against the tester's state.
- **Rule 11** ("seed realistic accumulated state") was followed for session state but not for intent state (BUG-41) — the rule said "realistic" but didn't mandate "actual."

## What Rule #12 Changes

Rule 12: **No bug closes without the beta tester's verified output.**

This is different from rules 1–11 because it moves the closure evidence from "our test passes" to "the tester's command succeeds." The tester runs their exact command against their actual repo. We paste their output. That is closure evidence. Nothing else is.

Rule 12 is necessary but still insufficient without:

- **Exact-command tests** (not helper-level tests) as the primary regression surface.
- **Multi-state fixtures** that seed the tester's actual on-disk state, not a simplified approximation.
- **Artifact-aware phantom detection** that covers all template types (generic, custom, explicit), not just the template manifest.

## What Changed in the Fix

BUG-42 (phantom intents):
- `isPhantomIntent()` detects approved intents whose planning artifacts already exist on disk
- Detection uses three artifact sources: intent-recorded, template-manifest, and planning-gate `requires_files`
- `archiveStaleIntentsForRun()` supersedes phantoms during startup
- `migrate-intents` expanded to `legacy_and_phantom` scope
- Exact-command test exercises `run --continue-from ... --continuous` against phantom state

BUG-43 (checkpoint staging):
- `normalizeFilesChanged()` filters ephemeral `.agentxchain/staging/` and `.agentxchain/dispatch/` paths
- Checkpoint reads accepted turn from durable `history.jsonl`, not staging
- Test seeds post-acceptance state with staging already cleaned up

## Structural Recommendations

1. **Ban helper-only tester-sequence tests.** Every BUG-N test must include at least one assertion against real CLI command output, not just helper return values.
2. **Require multi-version state fixtures.** For reconciliation bugs, the fixture must represent state that has been through at least 2 prior CLI versions with different migration behaviors.
3. **Treat "reproduces-on-tester-sequence: NO" as a falsifiable claim.** If the tester re-reports the same symptom, the claim was false and the closure must be reverted — no "this is a different bug" reframing to avoid the false-closure count.

## Timeline

| Version | Bug | Closure Claim | Reopened As | Root Cause of False Closure |
|---------|-----|--------------|-------------|---------------------------|
| v2.130.1 | BUG-17/19/20/21 | Fixed | BUG-36 | Clean fixtures, no accumulated state |
| v2.135.0 | BUG-36 | Fixed | BUG-39 | Single-state fixture, multi-version state on disk |
| v2.135.1 | BUG-39 | Fixed | BUG-40 | Session-flag stale-lock not seeded |
| v2.136.0 | BUG-40 | Fixed | BUG-41 | Same session-flag stale-lock |
| v2.137.0 | BUG-41 | Fixed | BUG-42 | Intent state evolved from null-scoped to phantom |

## Current Status (2026-04-18)

- BUG-42 fix code: shipped (phantom intent detection + supersession)
- BUG-43 fix code: shipped (checkpoint ephemeral path filtering)
- v2.138.0: pending release
- Tester verification: **not yet obtained** — BUG-42 and BUG-43 remain open per rule #12
- Next step: ship v2.138.0, get tester output, close only with real evidence
