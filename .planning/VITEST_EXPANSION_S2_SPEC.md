# Vitest Expansion Slice 2 — Docs-Content & Read-Only Contract Tests

> Status: **shipped**
> Depends on: VITEST_EXPANSION_S1_SPEC.md (shipped, 19 files, 489 tests)

---

## Purpose

Expand the Vitest runner to include all documentation-content guards and read-only contract tests. These files are the lowest-risk possible migration targets: they read files from disk and assert content. Zero writes, zero subprocesses, zero hooks, zero temp dirs.

This slice proves that Vitest handles pure-assertion content tests cleanly, and brings the total Vitest file count above the halfway point of the test suite by file count.

---

## Inclusion Criteria

A test file is eligible for Slice 2 if ALL of the following are true:

1. **Read-only FS access** — uses only `readFileSync` / `existsSync`, never `writeFileSync` / `mkdirSync` / `mkdtempSync`
2. **No `child_process` imports** — no `spawnSync`, `execSync`, `spawn`, `fork`
3. **No `before` / `after` hook imports** — uses only `describe` and `it` from `node:test`
4. **No temp directory creation** — no `os.tmpdir()`, no `import.meta.dirname` + subdir writes
5. **Guards documentation or spec content** — its purpose is drift prevention on docs, specs, or repo-surface contracts

---

## Eligible Files (11)

All files are pure read-only. No parallel-safety concern exists — they cannot collide.

| # | File | Tests | What it guards |
|---|------|-------|----------------|
| 1 | `openai-positioning-content.test.js` | 3 | OpenAI adapter positioning claims in docs |
| 2 | `template-surface-content.test.js` | 5 | Template surface completeness and naming |
| 3 | `docs-dashboard-content.test.js` | 14 | Dashboard documentation accuracy |
| 4 | `plugin-docs-content.test.js` | 19 | Plugin documentation completeness |
| 5 | `why-page-content.test.js` | 6 | "Why AgentXchain" page content integrity |
| 6 | `protocol-docs-content.test.js` | 6 | Protocol documentation accuracy |
| 7 | `protocol-implementor-guide-content.test.js` | 5 | Protocol implementor guide completeness |
| 8 | `release-docs-content.test.js` | 6 | Release documentation accuracy |
| 9 | `continuous-delivery-intake-content.test.js` | 5 | Intake lifecycle docs accuracy |
| 10 | `vitest-pilot-content.test.js` | 5 | Vitest pilot contract guard (meta) |
| 11 | `protocol-conformance-docs.test.js` | 4 | Protocol conformance documentation |

### Total: 11 files, ~78 tests

Combined with Slice 1: **30 files, ~567 tests under Vitest**.

---

## Explicitly Excluded From This Slice

| File | Reason |
|------|--------|
| `coordinator-*.test.js` (6 files) | Tightly coupled coordinator suite — dedicated slice |
| `e2e-*.test.js` | E2E tests stay on `node --test` per pilot spec |
| `context-section-parser.test.js` | Uses `writeFileSync` — not read-only |
| `claim.test.js` | Uses `spawnSync` — not read-only |
| `next-owner.test.js` | Uses `writeFileSync` + `mkdirSync` — not read-only |
| `launch-evidence.test.js` | Hardcoded-relpath + writes — deferred |
| `intake-*.test.js` | Command tests with subprocess-like behavior — deferred |
| `hook-*.test.js` | Hook lifecycle tests — deferred |

---

## Coexistence Rules

### Duplicate execution: YES (continues from Slice 1)

Per `DEC-VITEST-010`, redundancy drops only after >50% suite coverage under Vitest AND 3+ shipped slices without runner disagreements. After Slice 2, Vitest covers ~30 of ~50+ test files and 567 of ~1147 tests (~49%). We are approaching but have not crossed the 50% threshold. Dual execution continues.

### Shim dependency: MINIMAL

None of the 11 files import `before` or `after`. They use only `describe` and `it`. The `vitest-node-test-shim.js` alias still applies (it remaps `node:test`), but the `before`/`after` mapping code is not exercised by this slice.

### fileParallelism: remains `false`

Per `DEC-VITEST-009`, serial file execution continues until all hardcoded-relpath tests are resolved. Slice 2 files are all read-only and would be safe under parallel execution, but the config is shared with Slice 1 files that are not.

---

## Behavior

1. `npm run test:vitest` runs 30 files (19 Slice 1 + 11 Slice 2) via Vitest
2. `npm run test:node` runs all test files via `node --test` (including all 30 Vitest files)
3. `npm test` runs both sequentially — both must pass
4. Slice 2 files perform only `readFileSync` / `existsSync` calls — no cleanup needed

---

## Error Cases

- If a Slice 2 file gains `writeFileSync` or `child_process` imports, remove it from the Vitest include list
- If Vitest and `node --test` disagree on a test result, `node --test` is authoritative
- If `vitest-pilot-content.test.js` (the guard) fails because it asserts a stale file count, update the guard to match the new 30-file include list

---

## Acceptance Tests

- **AT-VE2-001**: `npm run test:vitest` exits 0 and reports all 30 files passing
- **AT-VE2-002**: `npm run test:node` exits 0 and reports the full suite passing
- **AT-VE2-003**: `npm test` exits 0 (both runners pass sequentially)
- **AT-VE2-004**: Vitest test count is ≥567 (489 Slice 1 + 78 Slice 2)
- **AT-VE2-005**: The `vitest-pilot-content.test.js` guard is updated to reflect the 30-file include list
- **AT-VE2-006**: No `child_process` import exists in any of the 30 Vitest-included files

---

## Implementation Checklist

1. Update `cli/vitest.config.js` with the 11 new files
2. Run `npm run test:vitest` — verify all 30 files pass
3. Run `npm run test:node` — verify full suite still passes
4. Run `npm test` — verify sequential pass
5. Update `cli/test/vitest-pilot-content.test.js` guard to expect 30 files
6. Update `VITEST_EXPANSION_S1_SPEC.md` to reference Slice 2
7. Commit and push
