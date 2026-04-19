# BUG-40 False Closure Retrospective

## Summary

`v2.136.0` claimed BUG-40 was closed because continuous startup migrated legacy null-scoped intents before queue selection. The shipped implementation only proved that behavior on a fresh `continuous-session.json`.

The tester's real repo had a pre-existing session file with:

- `current_run_id: "run_c8a4701ce0d4952d"`
- `startup_reconciled_run_id: "run_c8a4701ce0d4952d"`

That state caused `reconcileContinuousStartupState()` to skip `archiveStaleIntentsForRun()` entirely, leaving pre-BUG-34 intents on disk. Queue selection then picked a legacy planning intent and continuous mode aborted with `existing planning artifacts would be overwritten`.

## Root Cause

The bug was not in `archiveStaleIntentsForRun()` itself. The false closure was in the startup guard around it:

- file: `cli/src/lib/continuous-run.js`
- bad condition: `session.startup_reconciled_run_id !== scopedRunId`

That guard assumed "already reconciled for this run" implied "no legacy migration work remains." That assumption was wrong for two production-shaped cases:

1. a prior invocation set the session flag before the legacy files were archived
2. an earlier CLI version wrote the flag without running the now-shared migration helper

## Why The Existing Test Missed It

The original BUG-40 regression test only seeded:

- legacy intent files with `approved_run_id: null`
- existing planning artifacts that would be overwritten if stale queue selection happened

It did **not** seed the production-shaped stale-lock condition:

- a pre-existing `.agentxchain/continuous-session.json`
- `startup_reconciled_run_id` already equal to the active run id

So the test proved the clean-path migration, not the real failure mode.

## Fix Applied In BUG-41

- Continuous startup now always calls `archiveStaleIntentsForRun()` when a scoped run id exists.
- `startup_reconciled_run_id` is still updated for bookkeeping, but it no longer suppresses legacy-intent migration.
- New BUG-41 tester-sequence regression seeds the real stale session state and proves continuous startup still archives the legacy intents before queue selection.

## Discipline Update

Migration and reconciliation bugs must never be tested only from pristine fixtures again. Production-shaped regression tests must seed:

- pre-existing session files
- pre-existing state files
- pre-existing legacy on-disk artifacts

If the bug depends on accumulated repo state, the regression must include that accumulated repo state.
