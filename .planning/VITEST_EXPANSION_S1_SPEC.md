# Vitest Expansion Slice 1 — File-I/O Integration Tests

> Status: **shipped** — followed by Slice 2 (VITEST_EXPANSION_S2_SPEC.md)
> Depends on: VITEST_PILOT_SPEC.md (shipped, 7 files, 146 tests)

---

## Purpose

Expand the Vitest runner from 7 pure-unit files to include file-I/O integration tests that use `node:fs` but not `child_process`. This is the natural second tier: tests that create temp dirs, write/read files, and verify on-disk behavior — but never spawn subprocesses.

The goal is to prove that Vitest handles file-I/O tests reliably, with correct parallel isolation, before considering the subprocess tier.

---

## Inclusion Criteria

A test file is eligible for Slice 1 if ALL of the following are true:

1. **Uses `node:fs` or `fs` imports** — reads/writes files as part of test behavior
2. **No `child_process` imports** — no `spawnSync`, `execSync`, `spawn`
3. **No subprocess CLI invocation patterns** — no `bin/` imports, no shell execution
4. **Imports only from `../src/` or `../dashboard/`** — same as the pilot
5. **Uses isolated temp directories** — either `os.tmpdir()` with random suffix, or read-only fixture access, or hardcoded-relpath with per-test setup/teardown

### Parallel Safety Classification

| Pattern | Description | Vitest-safe? |
|---------|-------------|-------------|
| `random-tmpdir` | `os.tmpdir()` + random suffix per test | Yes — inherently isolated |
| `read-only` | Only reads fixture files, no writes | Yes — no mutation |
| `hardcoded-relpath` | `import.meta.dirname` + fixed subdir, with `setup()`/`teardown()` | Yes with `--no-file-parallelism` or sequential annotation — tests within the file clean up, but two Vitest workers hitting the same relpath would collide |

**Decision: `DEC-VITEST-009`** — Slice 1 runs with `--no-file-parallelism` (Vitest `fileParallelism: false` in config). This is conservative but correct. Within-file test parallelism stays off by default in Vitest anyway. We unlock file parallelism only after verifying no hardcoded-relpath tests remain, or after migrating them to random-tmpdir patterns.

---

## Eligible Files (12)

### Tier A: Random-tmpdir (parallel-safe, high value) — 8 files, ~233 tests

| # | File | Tests | What it tests |
|---|------|-------|---------------|
| 1 | `api-proxy-adapter.test.js` | 50 | API proxy dispatch, Anthropic request building, error classification |
| 2 | `dashboard-bridge.test.js` | 29 | Dashboard bridge server, invalidation, security, state querying |
| 3 | `gate-evaluator.test.js` | 28 | Phase gate evaluation and run completion logic |
| 4 | `dispatch-bundle.test.js` | 27 | Dispatch bundle writing and context document rendering |
| 5 | `step-command.test.js` | 27 | Step command execution for governed lifecycle |
| 6 | `local-cli-adapter.test.js` | 26 | Local CLI runtime adapter with manifest verification |
| 7 | `run-completion.test.js` | 26 | Run completion evaluation logic |
| 8 | `dispatch-manifest.test.js` | 20 | Content-addressed dispatch bundle manifest system |

### Tier B: Read-only fixtures (parallel-safe, medium value) — 3 files, ~72 tests

| # | File | Tests | What it tests |
|---|------|-------|---------------|
| 9 | `normalized-config.test.js` | 46 | Config normalization from legacy v3 to governed v4 |
| 10 | `schema.test.js` | 21 | JSON schema validation for locks, state, config, turn results |
| 11 | `safe-write.test.js` | 5 | Atomic file write operations |

Note: `safe-write.test.js` uses `import.meta.dirname` but the pattern is setup-then-cleanup within each `it()` block. At `fileParallelism: false` this is safe. If we later enable file parallelism, this one file needs migration to random-tmpdir.

### Tier C: Hardcoded-relpath (safe at `fileParallelism: false`) — 1 file, ~35 tests

| # | File | Tests | What it tests |
|---|------|-------|---------------|
| 12 | `turn-result-validator.test.js` | 35 | Staged turn result validation (5 stages) |

### Total: 12 files, ~340 tests

Combined with pilot: **19 files, ~486 tests under Vitest**.

### Explicitly Excluded From This Slice

| File | Reason |
|------|--------|
| `context-section-parser.test.js` | Only 4 tests — not worth the config noise. Include in next slice. |
| `launch-evidence.test.js` | Hardcoded-relpath + moderate complexity. Defer to next slice after relpath pattern is resolved. |
| `coordinator-*.test.js` (6 files) | These form a tightly coupled coordinator test suite. Better to migrate as a group in a dedicated slice. |
| `e2e-*.test.js` | E2E tests stay on `node --test` per pilot spec. |
| `*-content.test.js` (8 files) | Documentation content tests. Low-risk candidates for a future "docs tests" slice. |

---

## Coexistence Rules

### Duplicate execution: YES (continues from pilot)

**Decision: `DEC-VITEST-010`** — Slice 1 continues belt-and-suspenders. All 12 new files remain in both runners. The redundancy cost is ~340 extra test executions (~3-5s in Vitest, already counted in `node --test`'s ~28s). This is acceptable.

The trigger to drop redundancy is: when total Vitest-covered tests exceed 50% of the full suite AND at least 3 expansion slices have shipped without runner disagreements. Until then, dual execution stands.

### vitest.config.js changes

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      // ── Pilot (7 files, pure-unit) ──
      'test/token-counter.test.js',
      'test/token-budget.test.js',
      'test/context-compressor.test.js',
      'test/dashboard-app.test.js',
      'test/dashboard-evidence-drilldown.test.js',
      'test/dashboard-views.test.js',
      'test/verify-command.test.js',
      // ── Slice 1 (12 files, file-I/O integration) ──
      'test/api-proxy-adapter.test.js',
      'test/dashboard-bridge.test.js',
      'test/gate-evaluator.test.js',
      'test/dispatch-bundle.test.js',
      'test/step-command.test.js',
      'test/local-cli-adapter.test.js',
      'test/run-completion.test.js',
      'test/dispatch-manifest.test.js',
      'test/normalized-config.test.js',
      'test/schema.test.js',
      'test/safe-write.test.js',
      'test/turn-result-validator.test.js',
    ],
    fileParallelism: false,  // DEC-VITEST-009: conservative until hardcoded-relpath tests are migrated
    testTimeout: 10000,
  },
  resolve: {
    alias: { 'node:test': './test/vitest-node-test-shim.js' },
  },
});
```

### npm scripts: unchanged

```json
{
  "test": "npm run test:vitest && npm run test:node",
  "test:vitest": "vitest run --reporter=verbose",
  "test:node": "node --test test/*.test.js"
}
```

---

## Behavior

1. `npm run test:vitest` runs 19 files (7 pilot + 12 slice 1) via Vitest, sequentially per file
2. `npm run test:node` runs all test files via `node --test` (including all 19 Vitest files)
3. `npm test` runs Vitest first, then `node --test` — both must pass
4. File-I/O tests create isolated temp dirs and clean up in `afterEach`/`after` hooks
5. No import changes needed — the repo-local `vitest-node-test-shim.js` keeps `node:test` imports working under Vitest, including files that use `before` / `after`

---

## Error Cases

- If a Slice 1 file gains `child_process` imports, remove it from the Vitest include list and document why
- If Vitest and `node --test` disagree on a test result, `node --test` is authoritative (same as pilot)
- If `fileParallelism: false` causes unacceptable slowness (>15s for Vitest run), profile and consider enabling parallelism for Tier A files only
- If a hardcoded-relpath test fails intermittently under Vitest but not under `node --test`, migrate it to random-tmpdir pattern before investigating further

---

## Acceptance Tests

- **AT-VE1-001**: `npm run test:vitest` exits 0 and reports all 19 files passing
- **AT-VE1-002**: `npm run test:node` exits 0 and reports the full suite passing
- **AT-VE1-003**: `npm test` exits 0 (both runners pass sequentially)
- **AT-VE1-004**: Vitest test count is ≥486 (146 pilot + 340 slice 1)
- **AT-VE1-005**: Adding a failing assertion to a Slice 1 file causes both runners to fail
- **AT-VE1-006**: The `vitest-pilot-content.test.js` guard is updated to reflect the 19-file include list
- **AT-VE1-007**: No `child_process` import exists in any of the 19 Vitest-included files (automated guard)

---

## Implementation Checklist

1. Update `cli/vitest.config.js` with the 12 new files and `fileParallelism: false`
2. Run `npm run test:vitest` — verify all 19 files pass
3. Run `npm run test:node` — verify full suite still passes
4. Run `npm test` — verify sequential pass
5. Update `cli/test/vitest-pilot-content.test.js` guard to expect 19 files and add a `child_process` import guard
6. Update `VITEST_PILOT_SPEC.md` status to reference this expansion
7. Commit and push

---

## Resolved Questions

1. **`safe-write.test.js` stays as-is for Slice 1.** It remains in the Vitest include list behind `fileParallelism: false`. Migrate it to a random-tmpdir pattern only when the repo is ready to re-enable file parallelism.
2. **`vitest-pilot-content.test.js` keeps its current filename for Slice 1.** Renaming the guard now would add churn without improving the proof surface. Rename it only when the repo formally drops the "pilot" label in a later slice.
