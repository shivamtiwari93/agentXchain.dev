# Vitest Migration Assessment — AgentXchain CLI

> Assessment only. No implementation in this document.

---

## Current State

| Metric | Value |
|--------|-------|
| Test runner | `node --test` (Node.js built-in) |
| Assertion library | `node:assert/strict` |
| Test files | 58 (`cli/test/*.test.js`) |
| Tests | 1033 |
| Suites | 235 |
| Full-suite duration | ~15s |
| Mocking | 5 files use `mock` (via `node:test/mock` or manual stubs) |
| External test dependencies | Zero |
| npm test command | `node --test test/*.test.js` |
| File format | ESM (`"type": "module"` in package.json) |

---

## What Vitest Would Gain

1. **Watch mode.** `vitest --watch` re-runs affected tests on file change. `node --test --watch` exists but is less reliable for ESM and lacks dependency-graph awareness.

2. **Better DX for filtering.** Vitest's `describe.only`, `it.skip`, pattern-based file/test filtering, and UI mode are materially better for interactive development than `node --test`'s basic `--test-name-pattern`.

3. **Snapshot testing.** Useful for structured JSON output assertions (turn results, manifest schemas, hook envelopes). Currently these are manual deep-equal comparisons.

4. **Built-in coverage.** `vitest --coverage` with c8/istanbul integration. Currently no coverage tooling is configured.

5. **Parallel test isolation.** Vitest runs test files in isolated worker threads by default, preventing cross-file state leakage. `node --test` runs files sequentially in the same process unless `--experimental-test-isolation` is used.

6. **Ecosystem alignment.** The human operating model direction explicitly names Vitest as the preferred proof layer. Aligning now reduces future friction.

---

## What Vitest Would Cost

1. **New devDependency.** `vitest` pulls in `vite` as a peer. The `node_modules` footprint grows by ~30MB. For a CLI tool that ships zero test deps to users, this is acceptable — it's devDependencies only.

2. **Import rewriting.** Every test file imports from `node:test` (`describe`, `it`, `beforeEach`, `afterEach`) and `node:assert/strict`. These must change to Vitest equivalents:
   - `import { describe, it, beforeEach, afterEach } from 'node:test'` → `import { describe, it, beforeEach, afterEach } from 'vitest'`
   - `import assert from 'node:assert/strict'` → `import { expect } from 'vitest'`
   - All `assert.strictEqual(a, b)` → `expect(a).toBe(b)`
   - All `assert.deepStrictEqual(a, b)` → `expect(a).toEqual(b)`
   - All `assert.throws(() => ...)` → `expect(() => ...).toThrow(...)`
   - All `assert.ok(x)` → `expect(x).toBeTruthy()`
   - All `assert.rejects(async () => ...)` → `expect(async () => ...).rejects.toThrow(...)`

3. **Mock migration.** 5 files use `node:test/mock`. Vitest has `vi.fn()`, `vi.spyOn()`, `vi.mock()`. The APIs are different but the patterns are standard. Effort: moderate per file, bounded to 5 files.

4. **CI configuration.** The `npm test` script changes from `node --test test/*.test.js` to `vitest run`. The publish workflow's preflight runs `npm test`. No structural change, but the CI environment needs `vitest` available (already handled by `npm ci`).

5. **Config file.** Vitest needs a `vitest.config.js` or inline config in `vite.config.js`. Minimal for this project — just point at the test directory and set ESM mode.

---

## Migration Strategy

### Recommended: Incremental (file-by-file)

Vitest can coexist with `node --test` during migration. Strategy:

1. **Install Vitest.** `npm install --save-dev vitest`. Add `vitest.config.js` with `test.include: ['test/**/*.test.js']`.

2. **Add a parallel npm script.** `"test:vitest": "vitest run"`. Keep `"test": "node --test test/*.test.js"` as the primary until migration is complete.

3. **Migrate one file at a time.** Start with small, self-contained files (e.g., `safe-write.test.js`, `schema.test.js`, `token-counter.test.js`). Each migrated file:
   - Rewrite imports
   - Rewrite assertions from `assert.*` to `expect().*`
   - Run `npx vitest run test/<file>` to verify
   - Commit

4. **Migrate mock-using files last.** The 5 files using `node:test/mock` need the most careful rewrite.

5. **Switch primary script.** When all 58 files pass under Vitest, change `"test": "vitest run"` and remove the `node --test` script.

6. **Update CI, preflight, and evidence docs** in the same commit as the script switch.

### Why not big-bang?

A single commit rewriting 58 files (~6000 assertion replacements based on rough grep) is unreviewable and creates a merge-conflict bomb against any concurrent branch. Incremental migration allows each file to be verified independently and committed atomously.

---

## Runner Compatibility Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `node:test` `describe`/`it` API is similar but not identical to Vitest | Low | The subset we use (`describe`, `it`, `beforeEach`, `afterEach`) maps 1:1 |
| `assert.strictEqual` vs `expect().toBe` semantics | Low | Both use `Object.is` for primitives. `deepStrictEqual` vs `toEqual` differs on prototype checking — Vitest's `toEqual` is looser. Use `toStrictEqual` where prototype matters |
| Subprocess-spawning tests (E2E, hook-runner) | Medium | Vitest's worker isolation may interact with `child_process.spawnSync`. Test in the first E2E file migrated. If issues arise, configure `pool: 'forks'` or `singleThread: true` for those suites |
| Timer/timeout tests | Low | Vitest has `vi.useFakeTimers()` which is more capable than what we currently use. No risk |
| File-system tests (tmpdir creation/cleanup) | Low | Same Node.js `fs` APIs. No Vitest interaction |

---

## CI Implications

- **Speed.** Vitest is typically faster than `node --test` for large suites due to worker parallelism. Our 15s suite may drop to 8-12s. Not a primary motivation but a free gain.
- **Dependency footprint.** `npm ci` time increases by ~3-5s for the Vitest install. Negligible.
- **Node version.** Vitest requires Node 18+. We already require Node 18+ (ESM, `node:test`). No change.
- **Preflight/postflight scripts.** These call `npm test` which will transparently switch once the npm script is updated.

---

## Timing Decision: Before or After v2.1.0?

### Recommendation: After v2.1.0

**Arguments for after:**

1. v2.1.0 is feature-complete. The release branch (`release/v2.0.1`) is preflight-green. Adding a test framework migration now risks:
   - Evidence-count drift during migration
   - Merge conflicts with the release branch
   - A new class of "migration bug vs real bug" noise in CI
2. The current `node --test` runner is not broken. It runs 1033 tests in 15s with zero flakiness. There is no operational urgency.
3. Vitest migration is a developer-experience improvement, not a product improvement. It should not block a trust-hardening release.

**Arguments for before:**

1. The human operating model direction says "prefer Vitest." Shipping v2.1.0 on `node --test` and then immediately migrating creates churn in the release-adjacent window.
2. If v2.2 or v3 work starts immediately after v2.1.0, the migration competes with new feature work for attention.

**Verdict:** After v2.1.0. The risk of migration-induced noise during a release sequence outweighs the DX gain. Schedule as the first post-v2.1.0 infrastructure task, before v2.2 feature work begins.

---

## Effort Estimate

| Phase | Files | Estimated effort |
|-------|-------|-----------------|
| Setup (install, config, parallel script) | 2 | Small |
| Simple unit test files (no mocks, no subprocesses) | ~45 | Mechanical — import + assertion rewrite |
| E2E / subprocess files | ~8 | Medium — verify worker isolation compat |
| Mock-using files | 5 | Medium — rewrite mock APIs |
| Script switch + CI + evidence update | 3 | Small |
| **Total** | 58 | ~2 focused turns of agent work |

---

## Open Questions

1. Should snapshot testing replace any existing deep-equal assertions, or is it reserved for new tests only?
2. Should coverage reporting be added as part of the migration or deferred?
3. Should the migration coexist with a running `node --test` CI job for a validation period, or switch immediately once all files pass?

---

## Decision Required

This assessment recommends: **migrate after v2.1.0 ships, using incremental file-by-file strategy, as the first post-release infrastructure task.**

Pending: `DEC-VITEST-001` — to be made jointly in AGENT-TALK.md.
