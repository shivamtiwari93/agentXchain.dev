# Phantom Intent Reconciliation Spec

## Purpose

Prevent current-run intake intents from surviving as queueable `approved` work after their planning contract has already been satisfied.

BUG-42 showed the real failure mode is no longer only "legacy null-scoped intent." It is also "phantom intent": an intent that still looks dispatchable, but whose planning work already happened in the same run.

## Interface

- Startup reconciliation helper: `archiveStaleIntentsForRun(root, runId, options?)`
- Phantom detector: `isPhantomIntent(root, intent)`
- Manual repair command: `agentxchain migrate-intents [--dry-run] [--json]`
- Approval path: `approveIntent(root, intentId, options?)`

## Behavior

1. Phantom detection must prefer durable execution evidence over raw file existence.
2. Template-recorded planning artifacts on the intent remain authoritative evidence.
3. Planning-gate `requires_files` may be used as fallback phantom evidence only when there is durable proof that planning actually ran for the same run:
   - an accepted planning-history entry with the same `intent_id`, or
   - an accepted planning-history entry for the same `run_id` whose `accepted_at` is on or after the intent creation/approval timestamp
4. Scaffolding-only gate files are not phantom evidence.
5. If `approveIntent()` binds an intent onto the active run and the intent already satisfies phantom detection, approval must fail closed into `status: "superseded"` instead of creating a fresh queueable phantom.
6. Startup reconciliation and `migrate-intents` remain idempotent.

## Error Cases

- Treating scaffolded gate files as proof of completed planning creates false positives on fresh repos.
- Treating any current-run approval as valid without rechecking completion evidence reintroduces phantom intents through the approval path.
- Relying only on helper-level detection without command-path proof can miss startup regressions.

## Acceptance Tests

- BUG-42 exact-command proof: `run --continue-from ... --continuous` supersedes a generic-template phantom intent when the run history shows planning already happened.
- BUG-42 regression guard: scaffolded gate files without accepted planning history do not create a phantom.
- Intake approve regression: approving an already-satisfied stale intent in an active run supersedes it instead of leaving it `approved`.

## Open Questions

- History-backed fallback is still a proxy when older repos lack `intent_id` on accepted planning turns. That is acceptable for now, but the long-term contract should persist explicit intake satisfaction evidence rather than inferring it from files and timestamps.
