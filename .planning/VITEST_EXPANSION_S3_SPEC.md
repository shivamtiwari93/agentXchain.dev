# Vitest Expansion Slice 3 — Coordinator Suite

> Status: **shipped**
> Depends on: `VITEST_PILOT_SPEC.md`, `VITEST_EXPANSION_S1_SPEC.md`, `VITEST_EXPANSION_S2_SPEC.md`

---

## Purpose

Expand the Vitest coexistence runner to cover the multi-repo coordinator suite as one bounded slice instead of scattering those tests across unrelated migrations. The coordinator files exercise the most important repo-native coordination logic currently left outside Vitest, but they still avoid subprocess harnesses, network calls, and browser surfaces.

This slice also forces the next runner decision. After Slice 3, Vitest coverage will exceed 50 percent of the current `node --test` suite by test count. The repo needs an explicit answer on redundancy instead of sleepwalking into wrapper-script churn.

---

## Interface

### Files added to `cli/vitest.config.js`

Add these six files to the explicit include list:

1. `test/coordinator-acceptance.test.js`
2. `test/coordinator-config.test.js`
3. `test/coordinator-dispatch.test.js`
4. `test/coordinator-gates.test.js`
5. `test/coordinator-recovery.test.js`
6. `test/coordinator-state.test.js`

### Guard contract

- `cli/test/vitest-pilot-content.test.js` remains the repo-native guard for include-list drift, README drift, and exclusion-policy drift
- Slice 3 implementation should extend that guard to assert the six coordinator files are included and still do not import `child_process`
- No npm script changes in this slice:
  - `npm run test:vitest`
  - `npm run test:node`
  - `npm test`

### Runner model proposal

- Duplicate execution remains in force for Slice 3
- No `node --test` exclusion wrapper ships in this slice
- `node --test` remains the authoritative backstop while the repo still relies on a `node:test` compatibility shim under Vitest

---

## Behavior

### Eligibility audit

All six coordinator files are eligible because they meet every slice boundary:

| File | Tests | Eligible because |
|---|---:|---|
| `coordinator-acceptance.test.js` | 8 | `mkdtempSync(tmpdir(), 'axc-multi-accept-')`, no subprocess imports, no network |
| `coordinator-config.test.js` | 8 | temp workspace only, pure config validation, no subprocess imports |
| `coordinator-dispatch.test.js` | 8 | temp workspace only, dispatch logic via library calls, no subprocess harness |
| `coordinator-gates.test.js` | 6 | temp workspace only, gate evaluation via library calls, no subprocess imports |
| `coordinator-recovery.test.js` | 9 | temp workspace only, append/read JSONL recovery flow, no subprocess imports |
| `coordinator-state.test.js` | 9 | temp workspace only, state-file lifecycle, no subprocess imports |

Total added by Slice 3: **6 files, 48 tests**

Current shipped Vitest surface: **30 files, 572 tests**

Projected Vitest surface after Slice 3: **36 files, at least 620 tests**

Current `node --test` surface: **1147 tests, 250 suites**

Projected Vitest coverage after Slice 3: **620 / 1147 = 54.1% by test count**

### Compatibility evidence

The coordinator suite already runs cleanly under a temporary Vitest config using the shipped `vitest-node-test-shim.js` and `fileParallelism: false`:

- `npx vitest run --config <temp coordinator config>`: `6` files, `48` tests, pass, Vitest duration about `1.18s`
- `node --test` on the same six files: `48` tests, `9` suites, pass, duration about `0.21s`

This matters because it kills the lazy assumption that coordinator tests are “probably too stateful” for Vitest. They are not. They already pass.

### Parallel safety

Slice 3 does **not** introduce new reasons to keep serial file execution:

- every file creates unique temp workspaces under `tmpdir()`
- no file uses fixed repo-relative scratch paths
- no file imports `before`, `after`, `beforeEach`, or `afterEach`

`fileParallelism: false` still stays on in the shared config, but that is inherited from Slice 1 hardcoded-path tests such as `safe-write.test.js` and `turn-result-validator.test.js`, not from the coordinator suite itself.

### Redundancy proposal

Keep duplicate execution for Slice 3.

Reason:

1. The measured coordinator delta under `node --test` is too small to justify exclusion-wrapper complexity right now.
2. The repo still depends on a shimmed `node:test` contract under Vitest, so `node --test` remains the safest authority during migration.
3. A partial wrapper that excludes migrated files from `node --test` adds a second source of truth for file ownership unless it is generated. That is the wrong complexity to mix into the same turn as coordinator expansion.

Rejected in this slice:

- immediate `node --test` exclusion wrapper
- per-slice hybrid exclusion rules
- “permanent” duplicate execution as policy

If redundancy reduction happens later, it should ship as its own spec with a generated source-of-truth file list, not as incidental fallout from Slice 3.

---

## Error Cases

1. If any coordinator file gains a `child_process` import, remove it from the Vitest include list and write a dedicated subprocess migration spec instead of silently broadening Slice 3.
2. If Vitest and `node --test` disagree on any coordinator assertion, `node --test` wins and Slice 3 is not considered shipped.
3. If adding the six files pushes Vitest duration high enough to erase the fast-feedback value, do not cut redundancy inside this slice; measure first and treat runner-partitioning as a follow-on change.
4. If the guard test is still self-referential after Slice 3, accept that as a temporary quirk, not a blocker. The real protection lives in `node --test`, which already remains authoritative.

---

## Acceptance Tests

- **AT-VE3-001**: `npm run test:vitest` exits `0` with the six coordinator files added to the include list
- **AT-VE3-002**: `npm run test:node` exits `0` with the full suite still green
- **AT-VE3-003**: `npm test` exits `0`
- **AT-VE3-004**: Vitest covers exactly `36` files after Slice 3 ships
- **AT-VE3-005**: Vitest test count is at least `620`
- **AT-VE3-006**: No Vitest-included coordinator file imports `child_process`
- **AT-VE3-007**: README surfaces continue to describe the current Vitest slice accurately after the include list changes

---

## Open Questions

None for Slice 3. The key decisions are intentionally closed before implementation:

- coordinator tests are in scope
- duplicate execution stays on
- no exclusion wrapper ships in the same slice
