# System Spec — Vitest Migration: 663 node:test Files → Native Vitest Imports

**Run:** `run_4a6f8ae7668a237a`
**Baseline:** git:main (post-M3 completion)
**Package version:** `agentxchain@2.155.72`

## Purpose

Migrate all 663 test files in `cli/test/` from `node:test` imports to native vitest imports, eliminating the dual-runner architecture (vitest shim + native `node --test`) in favor of a single vitest runner with watch mode support for TDD.

**Scope:** Mechanical import migration via codemod, vitest config expansion from 36-file manifest to full glob, package.json script consolidation, and shim/manifest cleanup.

## Interface

### Test Runner Architecture (Before)

```
npm run test
  ├── test:vitest  → vitest run (36 files via slice manifest, node:test aliased to shim)
  └── test:node    → node --test (663 files natively, 60s timeout, 4-way concurrency)
```

- Files import `from 'node:test'`
- `vitest.config.js` aliases `node:test` → `vitest-node-test-shim.js`
- Shim re-exports vitest APIs with `node:test` names (`before` → `beforeAll`, etc.)
- Only 36/663 files in `vitest-slice-manifest.js`

### Test Runner Architecture (After)

```
npm run test       → vitest run --reporter=verbose (663 files, native vitest imports)
npm run test:watch → vitest --reporter=verbose (watch mode for TDD)
npm run test:beta  → node --test test/beta-tester-scenarios/*.test.js (standalone convenience)
```

- Files import `from 'vitest'`
- No shim, no alias, no manifest
- `vitest.config.js` uses glob: `test/**/*.test.js`
- `testTimeout: 60_000` (matches prior `node --test` timeout)
- `fileParallelism: false` (preserved from current config)

### Import Transformation Contract

| Pattern | Before | After | Files |
|---------|--------|-------|-------|
| Test runner | `from 'node:test'` | `from 'vitest'` | 663 |
| `before` hook | `import { before } from 'node:test'` | `import { beforeAll } from 'vitest'` | 56 |
| `after` hook | `import { after } from 'node:test'` | `import { afterAll } from 'vitest'` | 56 |
| `before()` call | `before(() => { ... })` | `beforeAll(() => { ... })` | 56 |
| `after()` call | `after(() => { ... })` | `afterAll(() => { ... })` | 56 |
| `t.skip()` | `t.skip(reason)` | vitest TestContext `skip()` | 1 |
| Assertions | `from 'node:assert/strict'` | unchanged | 432 |
| Assertions | `from 'node:assert'` | unchanged | 231 |

### Files Created

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `cli/scripts/migrate-to-vitest.mjs` | One-shot codemod script | Kept for reference; idempotent |

### Files Modified

| File | Change |
|------|--------|
| `cli/test/**/*.test.js` (663 files) | Import rewrite: `node:test` → `vitest`, `before`→`beforeAll`, `after`→`afterAll` |
| `cli/vitest.config.js` | Remove alias + manifest, use glob include, increase timeout |
| `cli/package.json` | Consolidate scripts: `test`, `test:watch`; remove `test:vitest`, `test:node` |

### Files Deleted

| File | Reason |
|------|--------|
| `cli/test-support/vitest-node-test-shim.js` | No longer needed — files import vitest directly |
| `cli/test-support/vitest-slice-manifest.js` | No longer needed — vitest uses glob pattern |

### Files Potentially Modified or Deleted

| File | Condition |
|------|-----------|
| `cli/test/vitest-contract.test.js` | If it tests the shim contract, remove. If it tests vitest behavior, update. |

## Behavior

### Codemod Execution

1. Script discovers all `*.test.js` files under `cli/test/` recursively
2. For each file:
   a. Read file content
   b. Match `import { ... } from 'node:test'` line
   c. In the import specifier list: rename `before` → `beforeAll`, `after` → `afterAll`
   d. Replace module specifier `'node:test'` → `'vitest'`
   e. If `before` or `after` was imported: rename `before(` → `beforeAll(` and `after(` → `afterAll(` in file body (word-boundary match, negative lookahead for `Each`/`All`)
   f. Write file back
3. Handle `t.skip()` in `bug-54-real-claude-reliability.test.js`
4. Print summary and exit 0

### Codemod Safety Invariants

- **Idempotent:** Running twice produces same output (already-migrated files are no-ops)
- **Assertion-preserving:** Zero changes to `node:assert` imports or assertion calls
- **Comment-preserving:** No changes to comments or strings (regex targets import/call sites only)
- **Scope-limited:** Only touches files matching `cli/test/**/*.test.js`

### Vitest Configuration

```js
// cli/vitest.config.js (after migration)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
```

### Watch Mode

- `vitest` (no `run` flag) enters watch mode by default
- Watches `cli/test/**/*.test.js` for changes
- Re-runs affected tests on file save
- Supports filter by test name (`vitest --reporter=verbose -t "pattern"`)

## Error Cases

| Failure Mode | Response |
|-------------|----------|
| Codemod regex misses an import variant | Post-migration grep catches it: `grep -r "from 'node:test'" cli/test/` |
| `before`/`after` rename catches string literal | Manual review of the 56 affected files (risk: low — these are structured test files) |
| E2E test exceeds 60s timeout | Increase `testTimeout` or use `test.timeout()` per-test |
| `vitest-contract.test.js` fails after shim removal | Update or remove the test |
| `test:beta` script uses `node --test` but files now import vitest | `node --test` ignores import specifiers at declaration time — tests still run natively if `vitest` is resolvable. Alternatively, `test:beta` can be updated to `vitest run test/beta-tester-scenarios/` |

## Acceptance Tests

- [ ] `grep -r "from 'node:test'" cli/test/` returns 0 results
- [ ] `npm run test` passes all 663 files (vitest run)
- [ ] `npm run test:watch` enters watch mode
- [ ] E2E tests (73 files) complete under vitest with subprocess spawning
- [ ] `vitest-node-test-shim.js` does not exist
- [ ] `vitest-slice-manifest.js` does not exist
- [ ] Diff shows only import changes + `before`/`after` renames (no assertion logic changes)
