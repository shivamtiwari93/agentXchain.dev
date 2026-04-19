## Purpose

Prevent legacy intake intents from breaking dispatch startup on existing governed repos.

The specific failure class is pre-BUG-34 intent files with `approved_run_id: null` and `run_id: null`. Startup paths must archive those files before any queue selection or dispatch logic can consume them.

## Interface

- Shared helper: `migratePreBug34Intents(root, runId, options?)`
- Shared startup reconciliation: `archiveStaleIntentsForRun(root, runId, options?)`
- Startup callers:
  - `initializeGovernedRun()`
  - `reactivateGovernedRun()`
  - continuous/session startup before queue scan
  - `consumeNextApprovedIntent()` as the final safety net for manual dispatch paths

## Behavior

1. A dispatch-capable startup path must know the effective `runId` before scanning approved/planned intents.
2. Startup reconciliation must:
   - adopt `cross_run_durable` pre-run approvals onto the active run
   - suppress approvals bound to a different run
   - archive legacy null-scoped intents as `archived_migration`
3. Legacy migration must happen before queue selection in continuous/schedule startup.
4. When legacy intents are archived, the system must:
   - emit `intents_migrated`
   - return/log a notice naming the archived intent IDs
5. Re-running the helper for the same run is idempotent.

## Error Cases

- If startup scans intents before run scoping, it can dispatch stale work from another run or a legacy null-scoped file.
- If migration only runs on new-run initialization, `--continue-from`, `resume`, `restart`, and scheduler pickup can bypass it.
- If the notice omits intent IDs, the operator cannot verify what changed.

## Acceptance Tests

- `bug-39-intent-migration-null-run-id.test.js`: new-run initialization archives legacy intents and emits `intents_migrated`.
- `bug-40-continuous-startup-legacy-intent-resume.test.js`: `run --continue-from ... --continuous` archives legacy intents before queue selection and does not hit the planning-overwrite failure.

## Open Questions

- Continuous mode still treats `--continue-from` as a startup run-scoping hint rather than a fully modeled provenance contract for child-run creation. That is sufficient for BUG-40 but should be revisited if lineage semantics expand.
