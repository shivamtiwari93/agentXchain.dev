# Acceptance Matrix — agentXchain.dev

**Run:** run_4b236357e5bdba02
**Turn:** turn_a48bda8f4228df2c (QA)
**Scope:** M3 Cross-Model Challenge Quality Regression Coverage

## Cross-Model Challenge Quality Acceptance Contract

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| CMC-001 | Integration test exercises accepted-turn persistence (not just static rendering) | Test at dispatch-bundle-decision-history.test.js:297 accepts a Dev turn from `local-gpt-5.5`, then a QA turn from `local-opus-4.6`, then generates a follow-up Dev dispatch context — exercises acceptGovernedTurn + writeDispatchBundle pipeline | PASS |
| CMC-002 | Decision ledger preserves `runtime_id` for cross-model turns | Test lines 356-358: `ledger.find(e => e.id === 'DEC-001').runtime_id === 'local-gpt-5.5'` and `DEC-002` → `local-opus-4.6` | PASS |
| CMC-003 | QA objections preserved in accepted history entry | Test lines 348-354: `history.at(-1).objections` deep-equals the OBJ-001 fixture with severity, statement, and status | PASS |
| CMC-004 | CONTEXT.md Last Accepted Turn renders runtime identity | Test line 364: regex match `## Last Accepted Turn[\s\S]*- \*\*Runtime:\*\* local-opus-4\.6` | PASS |
| CMC-005 | CONTEXT.md Decision History renders cross-model attribution | Test lines 366-367: exact row matches with `local-gpt-5.5` for DEC-001 and `local-opus-4.6` for DEC-002 | PASS |
| CMC-006 | Cross-model pair identifiable from ledger data (different runtime_ids) | Implicit in CMC-002: assertions require `local-gpt-5.5` ≠ `local-opus-4.6` for the two entries | PASS |
| CMC-007 | M3 ROADMAP item #4 checked off | ROADMAP.md:42 `- [x] Test cross-model challenge quality: does QA (Opus 4.6) effectively challenge Dev (GPT 5.5)?` | PASS |
| CMC-008 | M3 ROADMAP item #5 tracking annotation added | ROADMAP.md:43 contains `<!-- tracking: 3/4 roles validated across 3+ governed cycles ... eng_director not yet dispatched -->` | PASS |
| CMC-009 | No reserved files modified by dev | git show HEAD: 3 files — `.planning/IMPLEMENTATION_NOTES.md`, `.planning/ROADMAP.md`, `cli/test/dispatch-bundle-decision-history.test.js`. No `.agentxchain/` or `agentxchain.json` paths | PASS |
| CMC-010 | `agentxchain.json` unmodified | `git diff HEAD -- agentxchain.json` returns empty | PASS |

## Regression Suites

| Suite | Count | Result |
|-------|-------|--------|
| dispatch-bundle-decision-history.test.js | 11 | PASS |
| checkpoint-turn.test.js | 12 | PASS |
| governed-state.test.js | 99 | PASS |
| dispatch-bundle.test.js | 74 | PASS |
| turn-result-validator.test.js | 100 | PASS |
| staged-result-proof.test.js | 14 | PASS |
| continuous-run.test.js | 87 | PASS |
| local-cli-adapter.test.js | 46 | PASS |
| vision-reader.test.js | 36 | PASS |
| claude-local-auth-smoke-probe.test.js | 8 | PASS |
| config-schema + timeout-evaluator + run-loop + release-notes-gate | 87 | PASS |
| **Total** | **574** | **0 failures** |

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure from prior runs; predates this run | Not a regression — confirmed across 13 consecutive QA runs |
