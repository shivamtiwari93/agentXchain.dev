# BUG-39 False Closure Retrospective

## What BUG-39's shipped test actually proved

The original BUG-39 regression test proved only the **new-run initialization** path:

- seed legacy intent files with `approved_run_id: null`
- call `initializeGovernedRun()`
- assert the intents are archived and `intents_migrated` is emitted

That was real evidence for one code path. It was not evidence for startup more broadly.

## What it did not prove

It did **not** exercise any of the operator-visible startup paths that the beta tester was actually using:

- `agentxchain run --continue-from <run_id> --continuous`
- schedule-owned continuous session startup
- reactivation-based startup (`resume`, `step`, `restart`) before dispatch

Those paths can dispatch work without calling `initializeGovernedRun()`, so the test closed the bug on a subset of the actual surface.

## Why the false closure happened

1. We treated “migration exists somewhere” as “migration exists on every startup path.”
2. The regression test used a direct library call, not the tester's real CLI command.
3. We did not verify queue selection on an **existing repo with existing planning artifacts**.
4. We did not assert that startup surfaced the archived intent IDs back to the operator.

## The actual failure on `v2.135.1`

Two gaps combined:

1. Continuous startup began with `session.current_run_id = null`, so queue selection could scan legacy intents before run scoping.
2. Legacy intent migration only ran inside `initializeGovernedRun()`, so `--continue-from`/resume-style startup never archived those files first.

Result: continuous startup selected an old approved legacy intent, tried to plan it, and failed with `existing planning artifacts would be overwritten`.

## What changed in the correction

- Extracted startup migration into shared helpers:
  - `migratePreBug34Intents()`
  - `archiveStaleIntentsForRun()`
- `initializeGovernedRun()` now uses the shared helper instead of a one-off inline branch.
- `reactivateGovernedRun()` now runs startup migration too.
- Continuous startup now hydrates run scope before queue selection and archives legacy intents before scanning approved/planned work.
- Continuous startup emits `intents_migrated` and logs the archived intent IDs.

## Preventive rule

No future bug close may rely on a direct library-path test when the beta report is about an operator-visible CLI startup path. The regression must execute the real command or an equivalent end-to-end harness that hits the same startup graph.
