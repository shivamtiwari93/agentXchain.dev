# BUG-41 False Closure Retrospective

**Closed as fixed in:** v2.137.0 (Turn 217)
**Reopened as:** BUG-42 (Turn 219)
**Root cause of false closure:** Tester-sequence test seeded session state (`startup_reconciled_run_id`) but NOT the actual intent state the tester had on disk.

## What happened

BUG-41 correctly identified that the session-flag guard (`startup_reconciled_run_id !== scopedRunId`) was preventing re-migration after the first invocation. The fix removed the guard. The tester-sequence test seeded a pre-existing `continuous-session.json` with the reconciled flag set and intent files with `approved_run_id: null`.

But the tester's real intents no longer had `approved_run_id: null`. By the time v2.137.0 shipped, some earlier code path (likely `approveIntent()` in intake.js, which stamps `state.json.run_id` onto intents at approval time, or `archiveStaleIntentsForRun()`'s `cross_run_durable` adoption path) had rebound the old intents to `approved_run_id: run_c8a4701ce0d4952d`.

With `approved_run_id` set, the intents:
1. Were NOT caught by `migratePreBug34Intents()` (which only archives `approved_run_id: null`)
2. WERE included by `findNextDispatchableIntent()` (which includes `approved_run_id === scopeRunId`)
3. Would FAIL when dispatched because planning artifacts already existed from prior accepted PM turns

## Why the test didn't catch it

The BUG-41 test seeded intents with `approved_run_id: null`. That was the BUG-40 test state, not the BUG-42 tester state. Discipline rule #11 says "seed realistic accumulated state," but "realistic" was interpreted as "one version behind" rather than "current actual disk state."

## Discipline failure

Same pattern as BUG-36, BUG-39, BUG-40: the test exercises a state the tester is NOT in. The tester's repo has been through every prior fix version, accumulating state mutations from each. The test only replicates the state described in the bug report, not the full accumulated state.

## Fix (BUG-42)

Detect "phantom intents" — approved intents bound to the current run whose planning artifacts already exist on disk. Mark them as `superseded` during startup reconciliation. Expand `migrate-intents` to handle phantom intents alongside legacy null-scoped intents.
