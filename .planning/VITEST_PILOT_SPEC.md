# Vitest Pilot Spec — Narrow Coexistence Slice

> Status: **shipped**
> Expanded by: `VITEST_EXPANSION_S1_SPEC.md` (19 Vitest-included files total, duplicate execution still in force)
> Slice: pure-unit tests only — no file I/O, no subprocesses

---

## Purpose

Introduce Vitest as the fast-feedback test runner for pure-unit test suites while preserving `node --test` for integration, subprocess, and E2E tests. This document records the original coexistence pilot. The current steady-state contract is tracked in `VITEST_STEADY_STATE_SPEC.md`.

WAYS-OF-WORKING.md says: "bias toward a clearer Vitest-style fast-feedback model where appropriate, without pretending the migration is already complete." This spec implements that bias as a bounded first slice.

---

## Inclusion Criteria

A test file is eligible for the Vitest pilot if ALL of the following are true:

1. **No `node:fs` imports** — no `readFileSync`, `writeFileSync`, `mkdirSync`, `rmSync`, `existsSync`
2. **No `child_process` imports** — no `spawnSync`, `execSync`, `spawn`
3. **No `node:path` join/resolve for temp dirs** — no temporary directory creation
4. **No `before`/`after` hooks that create/destroy filesystem state**
5. **Imports only from repo-local pure modules under `../src/` or `../dashboard/`** — no bin/ imports, no CLI subprocess harnesses

### Eligible Files (7)

| File | What it tests |
|------|--------------|
| `token-counter.test.js` | Token counting pure logic |
| `token-budget.test.js` | Token budget evaluation |
| `context-compressor.test.js` | Context compression steps |
| `dashboard-app.test.js` | Dashboard SPA shell logic (DOM stubs, no real DOM) |
| `dashboard-evidence-drilldown.test.js` | Dashboard evidence drilldown view |
| `dashboard-views.test.js` | Dashboard view registry |
| `verify-command.test.js` | Command argument parsing |

### Exclusion Criteria

- **Any file using `node:fs`** stays on `node --test`
- **Any file using `child_process`** stays on `node --test`
- **E2E files (`e2e-*.test.js`)** stay on `node --test`
- **Files with subprocess CLI invocation patterns** stay on `node --test`

---

## Coexistence Rules

### npm Scripts

```json
{
  "test": "npm run test:vitest && npm run test:node",
  "test:vitest": "vitest run",
  "test:node": "node --test test/*.test.js --exclude='test/vitest/**'"
}
```

Wait — `node --test` does not support `--exclude`. Instead:

- Vitest tests move to `test/vitest/` directory
- `node --test` glob stays as `test/*.test.js` — since vitest files are in a subdirectory, they are not matched
- `vitest run` uses `vitest.config.js` pointing at `test/vitest/`

### Alternative: Keep files in place, use vitest include pattern

Actually, moving files breaks git blame and creates unnecessary churn. Better approach:

- Vitest config explicitly includes only the 7 eligible files by name
- `node --test` glob `test/*.test.js` still picks up all 71 files including the 7 vitest ones
- The 7 vitest files are run by BOTH runners during the pilot (belt and suspenders)
- Once the pilot is validated, a future slice can exclude them from `node --test`

This means: **zero file moves, zero import changes, both runners exercise the same files.**

### Final npm Scripts

```json
{
  "test": "npm run test:vitest && npm run test:node",
  "test:vitest": "vitest run --reporter=verbose",
  "test:node": "node --test test/*.test.js"
}
```

`DEC-VITEST-006`: during the pilot and the next expansion decision, the migrated files stay in both runners. Excluding Vitest-covered files from `node --test` is deferred until a later slice explicitly widens the pilot and proves the reduced redundancy is still safe.

### vitest.config.js

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/token-counter.test.js',
      'test/token-budget.test.js',
      'test/context-compressor.test.js',
      'test/dashboard-app.test.js',
      'test/dashboard-evidence-drilldown.test.js',
      'test/dashboard-views.test.js',
      'test/verify-command.test.js',
    ],
    testTimeout: 10000,
  },
});
```

### Import Compatibility

Vitest provides `describe`, `it`, `expect` as globals. But the existing tests import from `node:test`:

```js
import { describe, it } from 'node:test';
```

Vitest does NOT automatically shim `node:test`. The config uses `resolve.alias` to redirect `node:test` to a repo-local Vitest shim:

```js
resolve: {
  alias: { 'node:test': './test/vitest-node-test-shim.js' }
}
```

This means: under `node --test`, the real `node:test` module is used. Under Vitest, the shim maps `describe`/`it` plus `before`/`after` semantics onto Vitest's `beforeAll`/`afterAll` equivalents. **No import changes needed in test files.**

The existing `assert` usage (`node:assert/strict`) works under Vitest since it runs in a Node-compatible environment. **No assertion changes needed.**

---

## Behavior

1. `npm run test:vitest` runs only the 7 pilot files via Vitest
2. `npm run test:node` runs all 71 files via `node --test` (including the 7 pilot files)
3. `npm test` runs Vitest first, then `node --test` — both must pass for CI green
4. Vitest provides watch mode via `npx vitest` (not `vitest run`) for local dev
5. Total test count reported by `npm test` will be slightly higher than before (7 tests counted twice)

---

## Error Cases

- If a pilot file gains `node:fs` or `child_process` imports, or stops being a pure `../src/` / `../dashboard/` module consumer, it must be removed from the Vitest include list
- If Vitest shim for `node:test` breaks on a future Node.js version, the file stays on `node --test` only
- If the two runners disagree on a test result, the `node --test` result is authoritative during the pilot

---

## Acceptance Tests

- **AT-VP-001**: `npm run test:vitest` exits 0 and reports all 7 pilot files passing
- **AT-VP-002**: `npm run test:node` exits 0 and reports the full suite passing (including pilot files)
- **AT-VP-003**: `npm test` exits 0 (both runners pass sequentially)
- **AT-VP-004**: Adding a failing assertion to a pilot file causes both runners to fail
- **AT-VP-005**: Non-pilot files (e.g., `schema.test.js`) are NOT run by Vitest
- **AT-VP-006**: `npx vitest` (watch mode) starts successfully and re-runs on file change

---

## Open Questions

None. The pilot is narrow enough that all decisions can be made from the inclusion list and coexistence rules above.
