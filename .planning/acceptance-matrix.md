# Acceptance Matrix — agentXchain.dev

**Run:** run_fb3583590a1a4799
**Turn:** turn_0b9244cb1aeecf95 (QA)
**Scope:** M3 Multi-Model Turn Handoff Quality — runtime identity in decision ledger and CONTEXT.md rendering

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| AC-001 | Decision ledger entries persist runtime_id | `acceptGovernedTurn()` writes `runtime_id` from turn result into each decision ledger entry | Test at governed-state.test.js asserts `ledger[0].runtime_id === 'api-qa'` | 2026-05-01 | PASS |
| AC-002 | CONTEXT.md Last Accepted Turn renders runtime | When last accepted turn has `runtime_id`, CONTEXT.md includes `- **Runtime:** <runtime_id>` line | Test at dispatch-bundle.test.js asserts `context.match(/- \*\*Runtime:\*\* manual-pm/)` | 2026-05-01 | PASS |
| AC-003 | CONTEXT.md Last Accepted Turn omits runtime when absent | When last accepted turn has no `runtime_id`, the Runtime line is suppressed (no empty bullet) | Conditional guard `if (lastTurn.runtime_id)` verified in diff; no empty runtime rendered | 2026-05-01 | PASS |
| AC-004 | Decision History table includes Runtime column | CONTEXT.md decision history table has 5 columns: ID, Phase, Role, Runtime, Statement | Test at dispatch-bundle.test.js asserts `context.match(/\| ID \| Phase \| Role \| Runtime \| Statement \|/)` | 2026-05-01 | PASS |
| AC-005 | Old ledger entries render empty Runtime cell | Pre-M3 decision ledger entries (no runtime_id field) render an empty Runtime column, not `undefined` or error | Test asserts `\| DEC-001 \| planning \| pm \|  \| Old decisions without runtime still render. \|` | 2026-05-01 | PASS |
| AC-006 | New ledger entries render runtime in history table | Ledger entries with runtime_id show the value in the Runtime column | Test asserts `\| DEC-002 \| implementation \| dev \| local-dev \| Runtime identity is preserved in handoff context. \|` | 2026-05-01 | PASS |
| AC-007 | Stale tests updated, not weakened | Dev fixed tests to comply with implementation-phase product-code guard rather than removing the guard | Diff shows `src/dev-implementation.js` added to fixture, guard assertion preserved | 2026-05-01 | PASS |
| AC-008 | governed-state full suite — no regressions | All 99 tests pass | `node --test cli/test/governed-state.test.js` — 99 pass, 0 fail | 2026-05-01 | PASS |
| AC-009 | dispatch-bundle full suite — no regressions | All 74 tests pass | `node --test cli/test/dispatch-bundle.test.js` — 74 pass, 0 fail | 2026-05-01 | PASS |
| AC-010 | continuous-run suite — no regressions | All 87 tests pass | `node --test cli/test/continuous-run.test.js` — 87 pass, 0 fail | 2026-05-01 | PASS |
| AC-011 | vision-reader suite — no regressions | All 36 tests pass | `node --test cli/test/vision-reader.test.js` — 36 pass, 0 fail | 2026-05-01 | PASS |
| AC-012 | Validator + staged-result + adapter suites — no regressions | All 156 tests pass | `node --test cli/test/turn-result-validator.test.js cli/test/staged-result-proof.test.js cli/test/local-cli-adapter.test.js` — 156 pass, 0 fail | 2026-05-01 | PASS |
| AC-013 | Config + timeout + run-loop suites — no regressions | All 77 tests pass | `node --test cli/test/agentxchain-config-schema.test.js cli/test/timeout-evaluator.test.js cli/test/run-loop.test.js` — 77 pass, 0 fail | 2026-05-01 | PASS |
| AC-014 | Release notes gate suite — no regressions | All 10 tests pass | `node --test cli/test/release-notes-gate.test.js` — 10 pass, 0 fail | 2026-05-01 | PASS |
| AC-015 | BUG-77 end-to-end — no regressions | Full CLI path dispatches replenishment, completes run | `node --test cli/test/beta-tester-scenarios/bug-77-roadmap-exhausted-vision-open.test.js` — 1 pass, 0 fail | 2026-05-01 | PASS |
| AC-016 | No reserved path modifications by dev | Dev changes do not manually edit .agentxchain/state.json, history.jsonl, decision-ledger.jsonl, or lock.json | `git diff cae2d9a50..c7a1554fe -- .agentxchain/` returns empty | 2026-05-01 | PASS |
| AC-017 | Diff minimality | Dev changed exactly 6 declared files: governed-state.js (+1 line), dispatch-bundle.js (+7/-3 lines), 2 test files, IMPLEMENTATION_NOTES.md, ROADMAP.md | `git diff --stat` confirms 69 insertions, 6 deletions across 6 files | 2026-05-01 | PASS |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure, decision references, and handoff format from prior runs; predates this run entirely | Not a regression — pre-existing state issue; confirmed across 9 consecutive QA runs |

## Challenge Notes

The dev's implementation addresses the PM's M3 item #1 (model identity metadata in turn checkpoints / handoff context) with three targeted changes: (1) one new field persisted to the decision ledger at `governed-state.js:5241`, (2) conditional runtime rendering in Last Accepted Turn at `dispatch-bundle.js:800-802`, and (3) a Runtime column added to the decision history table at `dispatch-bundle.js:1418-1424`. The backward compatibility approach — empty string fallback via `(d.runtime_id || '')` for pre-M3 ledger entries — is correct and verified by a dedicated mixed old/new test. The dev's decision to update stale tests to comply with the implementation-phase guard (DEC-003) rather than weakening the guard is the right call — the guard prevents implementation turns from passing without product code changes, and the test fixture was incorrectly structured.
