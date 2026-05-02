# Release Notes

## User Impact

### MV Milestone Complete: Vitest Migration (663 Files)

The entire CLI test suite has been migrated from Node.js native `node:test` runner to Vitest. Developers now have:

1. **Single test runner** — `npm test` invokes vitest covering all 663 test files. The prior dual-runner architecture (vitest shim for 36 files + native node:test for 663 files) is eliminated.

2. **Watch mode for TDD** — `npm run test:watch` provides instant feedback on file changes. This was not possible with `node --test`.

3. **Simplified configuration** — No more vitest-node-test-shim.js, no more vitest-slice-manifest.js, no more resolve.alias magic. Tests import directly from `'vitest'`.

4. **Consistent timeouts** — All tests run with 60s timeout (matching prior node:test behavior), serial file execution, verbose reporter.

### Migration Summary

| Metric | Value |
|--------|-------|
| Files migrated | 663 |
| `before` → `beforeAll` renames | 56 files |
| `after` → `afterAll` renames | 56 files |
| Shim files deleted | 2 (vitest-node-test-shim.js, vitest-slice-manifest.js) |
| Scripts removed | 2 (test:vitest, test:node) |
| Scripts added | 1 (test:watch) |

### QA Intervention: Glob Regression Fix

The product-examples-contract test was broken by a glob-in-spawnSync pattern that Node v20 cannot resolve without shell expansion. QA fixed the regression by reverting to directory-based test discovery. All 22 product-examples-contract tests pass.

## Verification Summary

- 492 core tests independently verified by QA across 11 suites, 0 failures:
  - vitest-contract.test.js: 9 pass
  - dispatch-bundle-decision-history.test.js: 12 pass
  - governed-state.test.js: 99 pass
  - release-preflight.test.js: 17 pass
  - turn-result-validator.test.js: 100 pass
  - checkpoint-turn.test.js: 12 pass
  - local-cli-adapter.test.js: 46 pass
  - product-examples-contract.test.js: 22 pass (after fix)
  - continuous-run.test.js: 87 pass
  - staged-result-proof.test.js: 14 pass
  - dispatch-bundle.test.js: 74 pass
- Shim and manifest files confirmed deleted
- Zero live `node:test` imports (2 hits are test fixture strings)
- Package scripts correctly consolidated
- E2E subprocess tests pass under vitest

## Upgrade Notes

No breaking changes. The migration is transparent to CI and developers:
- `npm test` still works (now runs vitest instead of dual-runner)
- `node:assert` imports preserved — no assertion library migration
- `test:beta` convenience script preserved for standalone beta-scenario runs

## Known Issues

- AGENT-TALK collaboration log guard tests (3/8 fail) are a pre-existing state issue unrelated to this change. TALK.md lacks compressed summary structure from prior runs. Confirmed across 15 consecutive QA runs.
- **GSD 5-step workflow intent** (intent_1777697421568_4538) was injected at QA phase and cannot be satisfied by this run — requires fresh PM→Dev→QA cycle.
