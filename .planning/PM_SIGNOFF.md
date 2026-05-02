# PM Signoff — Vitest Migration: 663 node:test Files → Native Vitest Imports

Approved: YES

**Run:** `run_4a6f8ae7668a237a`
**Phase:** planning
**Turn:** `turn_bce5c1866bf6170d`
**Date:** 2026-05-02

## Discovery Checklist
- [x] Target user defined
- [x] Core pain point defined
- [x] Core workflow defined
- [x] MVP scope defined
- [x] Out-of-scope list defined
- [x] Success metric defined

### Target User

AgentXchain developers who need fast TDD feedback loops. Currently `npm run test` invokes a dual-runner (vitest then native `node --test`), doubling wall-clock time. Only 36 of 663 test files are in the vitest slice manifest, and the native runner lacks watch mode.

### Core Pain Point

The test suite runs under **two separate test runners** in sequence:

1. `test:vitest` — runs only 36 files listed in `vitest-slice-manifest.js` via vitest
2. `test:node` — runs all 663 files under native `node --test` (60s timeout, 4-way concurrency)

This dual-runner architecture exists because vitest adoption was incremental — files keep `node:test` imports and a shim (`vitest-node-test-shim.js`) aliases `node:test` → vitest at build time. The result:

- **No watch mode** for TDD — `node --test` doesn't support `--watch`
- **Slow feedback** — every test run pays the cost of two separate runners
- **Confusing config** — developers must understand the shim, the slice manifest, and why some files are in vitest but most aren't
- **36/663 coverage gap** — only 5.4% of files actually run under vitest; the rest bypass the vitest runner entirely

### Current Test Architecture

| Component | Purpose | Status |
|-----------|---------|--------|
| `cli/vitest.config.js` | Vitest config with `node:test` → shim alias | In use |
| `cli/test-support/vitest-node-test-shim.js` | Re-exports vitest APIs as `node:test` shape | In use (will be removed) |
| `cli/test-support/vitest-slice-manifest.js` | Explicit list of 36 files for vitest | In use (will be removed) |
| `test:vitest` script | Runs 36 files via vitest | In use (will run ALL files) |
| `test:node` script | Runs all files via native `node --test` | In use (will be removed) |

### API Usage Analysis (663 files)

| Pattern | Count | Migration Impact |
|---------|-------|-----------------|
| `import { describe, it, ... } from 'node:test'` | 663 files | Mechanical: swap module specifier |
| `import assert from 'node:assert/strict'` | 432 files | No change needed — works under vitest |
| `import { strict as assert } from 'node:assert'` | 231 files | No change needed — works under vitest |
| `before` / `after` hooks (from `node:test`) | 56 files | Rename to `beforeAll` / `afterAll` |
| `test()` function (instead of `it()`) | 3 files | Swap module specifier only |
| `t.skip()` TestContext | 1 file | Replace with vitest `ctx.skip()` |
| `mock` from `node:test` | 0 files | No migration needed |
| `test.skip` / `it.skip` / `describe.skip` | 0 files | No migration needed |
| `assert.throws` / `assert.doesNotThrow` | 9 files | No change — `node:assert` works under vitest |
| E2E tests with subprocess spawning | 71 files | Need extended timeout (60s) |
| Beta-tester-scenario tests | 98 files | Standard migration — all self-contained |

**Bottom line:** This is a **low-complexity, high-volume mechanical migration**. Zero files use `node:test`'s mock API, skip/only modifiers, or custom reporters. The only non-trivial patterns are 56 `before`/`after` → `beforeAll`/`afterAll` renames and 1 `t.skip()` → `ctx.skip()` change.

### Core Workflow

1. PM (this turn) — scope the migration, charter dev
2. Dev — write codemod script, execute migration, update vitest config and package.json
3. QA — verify all 663 tests pass under vitest, verify watch mode, verify E2E harness

### MVP Scope (this run)

**PM (this turn):** Migration analysis, dev charter, risk identification.

**Dev:** Five deliverables:

#### 1. Migration codemod script

Write `cli/scripts/migrate-to-vitest.mjs` — a one-shot script that:

**a) Rewrites imports in all 663 test files:**
- Parse the `import { ... } from 'node:test'` line
- Replace module specifier `'node:test'` → `'vitest'`
- In the import specifier list: rename `before` → `beforeAll`, `after` → `afterAll`
- Leave `describe`, `it`, `test`, `beforeEach`, `afterEach` unchanged (same names in vitest)
- Leave all `node:assert` / `node:assert/strict` imports unchanged

**b) Renames function calls in files that imported `before`/`after` (56 files):**
- Rename standalone `before(` calls → `beforeAll(` in the file body
- Rename standalone `after(` calls → `afterAll(` in the file body
- Must be careful not to rename `before`/`after` in strings, comments, or unrelated identifiers (use word-boundary matching)

**c) Handles the 1 TestContext file:**
- `cli/test/beta-tester-scenarios/bug-54-real-claude-reliability.test.js` (line 154): `t.skip(reason)` → vitest equivalent
- Vitest supports `ctx.skip()` in test callbacks: `it('name', (ctx) => { ctx.skip(); })`
- The `t` parameter name should be preserved or renamed to match vitest convention

**d) Runs and reports:**
- Print summary: N files migrated, N `before`→`beforeAll` renames, N `after`→`afterAll` renames, N TestContext fixes
- Exit 0 on success, exit 1 on any file I/O error

**Implementation note:** The codemod must be idempotent — running it twice should produce the same output. This allows re-running after manual fixes.

#### 2. Vitest config update

Update `cli/vitest.config.js`:

**Before:**
```js
import { VITEST_FILE_PARALLELISM, VITEST_INCLUDED_FILES } from './test-support/vitest-slice-manifest.js';
// ...
include: VITEST_INCLUDED_FILES,
fileParallelism: VITEST_FILE_PARALLELISM,
testTimeout: 10000,
```

**After:**
```js
// Remove slice manifest import entirely
// Remove node:test alias (no longer needed — files import vitest directly)
// ...
include: ['test/**/*.test.js'],
fileParallelism: false,  // keep serial until temp-dir isolation is validated
testTimeout: 60_000,     // match prior node --test timeout for E2E/subprocess tests
```

Remove the `resolve.alias` block — the shim is no longer needed since files import `vitest` directly.

#### 3. Package.json script update

**Changes to `cli/package.json` scripts:**

| Script | Before | After |
|--------|--------|-------|
| `test` | `npm run test:vitest && npm run test:node` | `vitest run --reporter=verbose` |
| `test:vitest` | `vitest run --reporter=verbose` | Remove (merged into `test`) |
| `test:node` | `node --test --test-timeout=60000 ...` | Remove (no longer needed) |
| `test:watch` | (does not exist) | `vitest --reporter=verbose` (new) |
| `test:beta` | `node --test test/beta-tester-scenarios/*.test.js` | Keep as-is for standalone beta runs |

#### 4. Cleanup

- Delete `cli/test-support/vitest-node-test-shim.js` — no longer needed
- Delete `cli/test-support/vitest-slice-manifest.js` — no longer needed
- Verify `cli/test/vitest-contract.test.js` — this file tests the shim contract; it should be updated or removed

#### 5. Verification

Run `npm run test` (which now invokes vitest) and verify:
- All 663 test files are discovered by vitest
- All tests pass
- `npm run test:watch` enters watch mode and responds to file changes
- E2E tests complete within the 60s timeout
- No remaining `from 'node:test'` imports in any test file

### Out of Scope

- **Migrating `node:assert` → vitest `expect`** — Assertion library migration is a separate, much larger effort. `node:assert` works perfectly under vitest. Mixing the two migrations would increase risk for zero functional benefit.
- **Enabling file parallelism** — Keep `fileParallelism: false` for now. Parallel execution requires validating that all tests use unique temp directories and don't have implicit ordering. This is a follow-up optimization.
- **Adding vitest-specific features** — No snapshot testing, no coverage configuration, no custom reporters beyond verbose. Keep the migration minimal.
- **Migrating example project tests** — The 5 vitest files in `examples/Baby Tracker/` and the 4 node:test files in other example projects are out of scope. This migration covers `cli/test/` only.
- **Changes to test logic or assertions** — The codemod changes imports only. No test behavior changes.
- **Vitest UI or browser mode** — Not needed for CLI testing.

### Success Metric

1. Zero files import `from 'node:test'` in `cli/test/` (grep confirms 0 matches)
2. `npm run test` (vitest) passes — all 663 files, all tests green
3. `npm run test:watch` enters vitest watch mode
4. E2E tests (73 files) run under vitest with subprocess spawning working correctly
5. `vitest-node-test-shim.js` and `vitest-slice-manifest.js` are deleted

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `before`/`after` rename catches unrelated identifiers | Medium | Word-boundary regex (`\bbefore\(` not matching `beforeEach(`) with negative lookahead for `Each` |
| E2E subprocess tests timeout under vitest | Medium | Increase `testTimeout` to 60s (matching prior `node --test` config) |
| `fileParallelism: false` masks ordering bugs | Low | Accept serial for now; parallelism is a follow-up |
| Codemod misses edge-case import syntax | Low | Verify with grep post-migration: `grep -r "from 'node:test'" cli/test/` must return 0 |
| `vitest-contract.test.js` breaks after shim removal | Low | File tests the shim itself; update or remove as part of cleanup |
| `test:beta` script still uses `node --test` | Low | Acceptable — beta tests also run under vitest via `npm run test`; standalone `test:beta` is a convenience alias |

## Challenge to Previous Work

### OBJ-PM-001: The incremental slice-manifest approach created permanent architectural debt (severity: medium)

The prior vitest adoption strategy (runs `run_cc4217fafd6611bc` through `run_d758c25c8d0ba32d`) treated vitest migration as a gradual, file-by-file process — adding files to `vitest-slice-manifest.js` one slice at a time. After 6+ governed runs, only 36/663 files (5.4%) were in the vitest manifest. At this rate, full migration would take 100+ runs.

The slice-by-slice approach was **correct as an initial de-risking strategy** (proving the shim works, validating vitest compatibility), but it was never elevated to a full migration plan. The dual-runner architecture became normalized rather than treated as a transition state.

This run corrects the approach: instead of continuing to add files to the manifest one slice at a time, we write a codemod that migrates all 663 files in a single pass, then delete the shim and manifest entirely.

### OBJ-PM-002: The dual-runner architecture doubles CI time for no incremental safety (severity: low)

Running tests under both vitest (via shim) and native `node --test` was a safety net during the transition. But once the shim was proven correct (36 files, zero discrepancies across 6 runs), continuing to run both runners provides no additional confidence. The `test:node` runner is pure overhead.

## Notes for Dev

**Your charter is: codemod script + vitest config update + package.json update + cleanup + verification.**

The migration is mechanical — 663 files, same transformation pattern. The codemod is the critical deliverable. Key implementation details:

1. **Import regex pattern:** Match `import\s*\{([^}]+)\}\s*from\s*'node:test'` — capture the specifier list, swap `before` → `beforeAll` and `after` → `afterAll` within it, replace module with `'vitest'`

2. **Body rename for `before`/`after`:** Only needed in the 56 files that import them. Use `\bbefore\s*\(` → `beforeAll(` and `\bafter\s*\(` → `afterAll(` with negative lookahead for `Each` and `All` to avoid double-renaming. Be careful with `after(` appearing in strings — the 56 files are structured test files where `after(` at statement level is always the hook.

3. **TestContext (`t.skip`):** Only 1 file: `bug-54-real-claude-reliability.test.js:154`. The pattern is `it('name', async (t) => { ... t.skip(reason); ... })`. In vitest, the equivalent is `it('name', async ({ skip }) => { ... skip(); ... })` or keeping `t` and calling `t.skip()` if vitest's test context supports it (vitest 1.x+ does via `TaskContext`).

4. **vitest-contract.test.js** likely tests the shim → vitest mapping. Read it. If it asserts that `node:test` imports resolve to vitest, it's obsolete after migration and should be removed. If it tests something else, update it.

5. **Do NOT change assertions.** Leave all `assert.strictEqual`, `assert.deepStrictEqual`, `assert.ok`, `assert.throws` calls exactly as they are. `node:assert` is a Node.js built-in that works under vitest without any shim.

## Notes for QA

- **Primary verification:** `grep -r "from 'node:test'" cli/test/` must return 0 results
- **Full suite pass:** `npm run test` must pass all 663 files with 0 failures
- **Watch mode:** `npm run test:watch` must enter interactive watch mode (verify it starts, then Ctrl-C)
- **E2E subset:** Verify at least 5 E2E tests (subprocess-heavy) complete under vitest
- **Cleanup verification:** `vitest-node-test-shim.js` and `vitest-slice-manifest.js` must not exist
- **No assertion changes:** Diff should show ONLY import line changes, `before`→`beforeAll` renames, and `after`→`afterAll` renames — no assertion logic changes
- **Regression risk:** The `before`/`after` → `beforeAll`/`afterAll` rename is the highest-risk transformation. Verify 5-10 of the 56 affected files to confirm the rename is correct.

## Acceptance Contract Response

1. **All 565 test files use vitest imports instead of node:test** — YES (after dev implements). The codemod will migrate all 663 files (565 main + 98 beta-tester-scenarios). Post-migration, `grep -r "from 'node:test'" cli/test/` returns 0.

2. **npm run test:vitest passes with all tests** — YES (after dev implements). The `test` script will invoke `vitest run` covering all 663 files. The prior `test:vitest` script is merged into `test`.

3. **Vitest watch mode works for TDD development** — YES (after dev implements). New `test:watch` script runs `vitest` in watch mode. Vitest watch mode is a core vitest feature that works out of the box.

4. **E2E tests run under vitest harness** — YES (after dev implements). All 73 E2E test files will be included in the vitest glob pattern (`test/**/*.test.js`). Extended `testTimeout: 60_000` accommodates subprocess-heavy E2E tests.
