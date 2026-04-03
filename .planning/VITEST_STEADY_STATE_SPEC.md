# Vitest Steady State Contract

> Status: **shipped**
> Depends on: `VITEST_PILOT_SPEC.md`, `VITEST_EXPANSION_S1_SPEC.md`, `VITEST_EXPANSION_S2_SPEC.md`, `VITEST_EXPANSION_S3_SPEC.md`

---

## Purpose

Freeze the current Vitest coexistence surface as the repo's deliberate steady state until there is a concrete subprocess-test strategy worth implementing.

This slice does two things:

1. Stops hand-copying the Vitest include list between `cli/vitest.config.js` and the guard test.
2. Retires the stale `vitest-pilot-content.test.js` filename now that the repo has moved beyond a 7-file pilot.

This is not a Slice 4 expansion. The current Vitest surface remains **36 files**. The missing tests are overwhelmingly subprocess-heavy, and pretending otherwise would be lazy scope control.

---

## Interface

### New shared source of truth

Add `cli/test/vitest-slice-manifest.js` exporting:

- `VITEST_INCLUDED_FILES`
- `VITEST_FILE_COUNT`
- `VITEST_FILE_PARALLELISM`

`cli/vitest.config.js` and the guard test must both import from this module.

### Guard rename

Rename:

- `cli/test/vitest-pilot-content.test.js`

to:

- `cli/test/vitest-contract.test.js`

The renamed file remains in the Vitest include list and continues to run under both runners.

### Current steady-state boundary

- Vitest steady state: **36 files**
- Duplicate execution: **YES**
- `node --test` remains authoritative for disagreements
- No Slice 4 ships until a dedicated subprocess/E2E strategy spec exists

---

## Behavior

### Why expansion stops here

The non-Vitest remainder is not another easy bucket. The repo currently has 33 non-Vitest files:

- 28 import `child_process` directly
- 5 do not import `child_process`, but they still fall into categories that do not justify an automatic Slice 4:
  - `e2e-dashboard.test.js`: real server + websocket + timing-sensitive E2E behavior
  - `context-section-parser.test.js`: broader file-writing integration contract
  - `next-owner.test.js`: fixed repo-relative scratch path
  - `launch-evidence.test.js`: launch-copy drift guard, low leverage for Vitest
  - `template-spec-consistency.test.js`: spec drift guard, low leverage for Vitest

That means there is no honest “just add another include list” slice left. Any further expansion needs a new strategy, not more momentum.

### Shared manifest behavior

- `cli/vitest.config.js` must read its include list and `fileParallelism` flag from `cli/test/vitest-slice-manifest.js`
- `cli/test/vitest-contract.test.js` must import the same manifest instead of duplicating the array inline
- The guard remains a single file for now

### Why the guard does not split yet

Do not split the guard in this slice.

Reason:

1. The real drift risk was duplicated source of truth, not the file's current size.
2. Renaming the guard and centralizing the manifest are enough to keep the 36-file steady state durable.
3. Splitting the guard before a new slice exists would add churn without reducing a real failure mode.

---

## Error Cases

1. If a future change edits the Vitest include list directly in `cli/vitest.config.js` instead of the shared manifest, the contract guard should fail.
2. If a future slice wants to add subprocess, CLI, hook-lifecycle, or E2E tests, it must ship with a dedicated strategy spec first. This steady-state contract does not authorize that expansion.
3. If the renamed guard is missing from the Vitest include list, the contract is broken even if `node --test` still catches the file.
4. If a future slice makes guard splitting necessary, do it with a dedicated spec. Do not hide it inside unrelated product work.

---

## Acceptance Tests

- **AT-VSS-001**: `npm run test:vitest` exits `0` and still reports `36` passing files
- **AT-VSS-002**: `npm run test:node` exits `0`
- **AT-VSS-003**: `npm test` exits `0`
- **AT-VSS-004**: `cli/vitest.config.js` imports `VITEST_INCLUDED_FILES` and `VITEST_FILE_PARALLELISM` from `cli/test/vitest-slice-manifest.js`
- **AT-VSS-005**: `cli/test/vitest-contract.test.js` imports `VITEST_INCLUDED_FILES` and `VITEST_FILE_COUNT` from `cli/test/vitest-slice-manifest.js`
- **AT-VSS-006**: Planning specs reference `cli/test/vitest-contract.test.js`, not the retired `vitest-pilot-content.test.js`

---

## Open Questions

None.
