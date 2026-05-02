# Acceptance Matrix — agentXchain.dev

**Run:** run_d758c25c8d0ba32d
**Turn:** turn_a7d3379ef735ae71 (QA)
**Scope:** M3 eng_director Acceptance Pipeline Regression + M3 #5 Completion

## eng_director Escalation Acceptance Contract

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| ED-001 | Integration test exercises full governed persistence pipeline (not shallow rendering) | Test at dispatch-bundle-decision-history.test.js:371 accepts a dev turn proposing eng_director, assigns and accepts a director turn, then generates QA CONTEXT.md — exercises initializeGovernedRun + assignGovernedTurn + acceptGovernedTurn pipeline end-to-end | PASS |
| ED-002 | Director turn persists in history.jsonl with role and runtime_id | Test lines 423-426: `directorHistory.role === 'eng_director'` and `directorHistory.runtime_id === 'local-gpt-5.5'` | PASS |
| ED-003 | Director objections preserved in accepted history entry | Test lines 427-432: `directorHistory.objections` deep-equals OBJ-001 fixture with severity, statement, and status | PASS |
| ED-004 | Decision ledger preserves runtime_id for both dev and director decisions | Test lines 434-438: DEC-001 `runtime_id === 'local-gpt-5.5'`, DEC-002 `role === 'eng_director'` and `runtime_id === 'local-gpt-5.5'` | PASS |
| ED-005 | CONTEXT.md Last Accepted Turn renders director role and runtime | Test line 444: regex match `## Last Accepted Turn[\s\S]*- \*\*Role:\*\* eng_director[\s\S]*- \*\*Runtime:\*\* local-gpt-5\.5` | PASS |
| ED-006 | CONTEXT.md Last Accepted Turn renders director objections | Test line 445: regex match `- \*\*Objections:\*\*[\s\S]*OBJ-001 (medium): Do not mark escalation coverage complete unless director runtime evidence is persisted.` | PASS |
| ED-007 | CONTEXT.md Decision History renders both dev and director decisions with correct attribution | Test lines 446-447: exact row matches `| DEC-001 | implementation | dev | local-gpt-5.5 |` and `| DEC-002 | implementation | eng_director | local-gpt-5.5 |` | PASS |
| ED-008 | Test fixture eng_director config matches production agentxchain.json | Fixture line 59: `runtime_id: 'local-gpt-5.5'`, production agentxchain.json line 32: `"runtime": "local-gpt-5.5"`. Routing eligibility in all 3 phases matches production | PASS |
| ED-009 | M3 #5 check-off justified | PM/Dev/QA: 13+ production cycles. eng_director: governed-pipeline integration test. Escalation-only role cannot be exercised via normal PM->Dev->QA cycles without manufacturing deadlocks | PASS |
| ED-010 | No reserved files modified by dev | git show HEAD --name-only: 3 files — `.planning/IMPLEMENTATION_NOTES.md`, `.planning/ROADMAP.md`, `cli/test/dispatch-bundle-decision-history.test.js`. No `.agentxchain/` or `agentxchain.json` paths | PASS |

## Regression Suites

| Suite | Count | Result |
|-------|-------|--------|
| dispatch-bundle-decision-history.test.js | 12 | PASS |
| checkpoint-turn.test.js | 12 | PASS |
| governed-state.test.js | 99 | PASS |
| dispatch-bundle.test.js | 74 | PASS |
| turn-result-validator.test.js | 100 | PASS |
| staged-result-proof.test.js | 14 | PASS |
| continuous-run.test.js | 87 | PASS |
| local-cli-adapter.test.js | 46 | PASS |
| vision-reader.test.js | 36 | PASS |
| claude-local-auth-smoke-probe.test.js | 8 | PASS |
| timeout-evaluator + run-loop + release-notes-gate | 80 | PASS |
| config-governed.test.js | 28 | PASS |
| **Core total** | **596** | **0 failures** |

## Full Suite Summary

| Metric | Value |
|--------|-------|
| Total tests | 7024 |
| Pass | 6993 |
| Fail | 30 |
| Cancelled | 1 |

The 30 failures are in E2E/infrastructure-dependent suites (adapter interface, delegation chains, enterprise dashboard, MCP governed, protocol conformance, mixed-runtime parallel, etc.) — none are related to the eng_director change or any file modified in this run.

## Pre-existing Failures (Not Blocking)

| Issue | Detail | Verdict |
|-------|--------|---------|
| AGENT-TALK guard (3/8 fail) | Tests 4-6 fail: TALK.md lacks compressed summary structure from prior runs; predates this run | Not a regression — confirmed across 14 consecutive QA runs |
