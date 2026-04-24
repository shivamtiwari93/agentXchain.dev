# BUG-65 Framework Report Artifact Spec

## Purpose

Prevent framework-generated governance reports from being attributed to the next agent turn as undeclared workspace output.

## Interface

- Repo observation continues to use `classifyRepoPath()`, `isOperationalPath()`, `observeChanges()`, and `normalizeCheckpointableFiles()`.
- Framework-generated report paths under `.agentxchain/reports/` are operational:
  - `.agentxchain/reports/report-*.md`
  - `.agentxchain/reports/export-*.json`
  - `.agentxchain/reports/chain-*.json`
- Other `.agentxchain/reports/` files remain baseline-exempt continuity artifacts and may still be checkpointed when a turn explicitly owns them.

## Behavior

- A generated governance report created after a turn baseline is not included in `observeChanges().files_changed`.
- Generated governance reports are excluded from checkpointable turn files.
- Custom report artifacts under `.agentxchain/reports/` remain observable when they change after baseline.
- Baseline cleanliness semantics remain unchanged: `.agentxchain/reports/` dirt is still baseline-exempt.

## Error Cases

- A real product file dirty after baseline must still be observed and rejected when undeclared.
- A custom report artifact such as `.agentxchain/reports/RECOVERY_REPORT.md` must not be silently hidden as operational.
- A generated report with a non-matching extension or name must not be hidden by broad prefix logic.

## Acceptance Tests

- `repo-observer.test.js` proves generated `report-*`, `export-*`, and `chain-*` report artifacts are operational and excluded from observation.
- `repo-observer.test.js` proves a custom `.agentxchain/reports/RECOVERY_REPORT.md` file remains observable.
- `framework-write-exclusion.test.js` lists generated reports as framework-owned write paths so future framework writes cannot regress observation.
- `claim-reality-preflight.test.js` proves packaged `accept-turn` accepts a declared workspace change while generated governance reports are dirty.
- Existing BUG-55 undeclared verification output tests still reject real undeclared actor outputs.

## Open Questions

- None for BUG-65. BUG-67 separately owns report-generation scalability.
