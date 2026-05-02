# Ship Verdict — agentXchain.dev

## Verdict: SHIP

## QA Summary

**Run:** run_3a396386e18575b6
**Turn:** turn_7f56b1588cdeebb0 (QA)
**Scope:** Config protection (agentxchain.json operator-owned guardrails) + M3 Codex output format validation

### Challenge of Prior QA Turn

The previous QA turn (turn_080c074e61bbd5eb) approved the implementation but had two issues that blocked the gate:

1. **Acceptance matrix gate failure:** CP-005 and CP-006 were marked `PASS (see note 1)` instead of plain `PASS`. The gate validator rejected these rows because it performs strict Status matching. The note content was legitimate (explaining section naming differences), but the Status cell contained the annotation rather than the Evidence cell. **Fixed this turn** by moving annotations to the Evidence column.

2. **Missed test regression:** The prior QA ran only 9 curated test suites (551 tests) and did not run `dispatch-bundle-decision-history.test.js`, which had 2 failing tests. These failures were caused by the M3 runtime_id implementation adding a Runtime column to the Decision History table (`dispatch-bundle.js:1418`) without updating the corresponding test expectations. The test expected `| ID | Phase | Role | Statement |` but the implementation now renders `| ID | Phase | Role | Runtime | Statement |`. **Fixed this turn** by updating the test to match the 5-column format.

### Challenge of Dev Turn

The dev's implementation (turn_65b0f055586a2a77) delivered Codex output format validation as chartered. Specific challenges (carried forward from prior QA, independently re-verified):

1. **Codex runtime detection (DEC-001):** `isCodexLocalCliRuntime()` matches `codex` or paths ending with `/codex`, consistent with existing Claude detector pattern. Version-suffixed binaries are correctly excluded. ✓

2. **Codex auth failure classification (DEC-001):** `hasCodexAuthFailureOutput()` regex is OR'd across specific patterns (`unauthorized`, `invalid api key`, `invalid_api_key`, `authentication failed`, `openai.*401`, `api_key.*invalid`), sufficiently specific for auth failure classification. False positives are prevented by the runtime type guard. ✓

3. **Codex flag validation (DEC-002):** `validateLocalCliCommandCompatibility()` requires `exec` subcommand as prerequisite — without `exec`, command is blocked before `--json` check. Correct cascade behavior. ✓

4. **Adapter close handler Codex branch (DEC-001):** Structure is `if (claude_auth) ... else if (codex_auth) ... else (generic)`. Falls through correctly. ✓

5. **Reserved file integrity:** Dev did not modify `.agentxchain/` orchestrator-owned files or `agentxchain.json`. ✓

### Config Protection Verification

All 4 role prompts contain "Do NOT modify `agentxchain.json`" instruction:

| Prompt | Line | Section | Escalation guidance |
|--------|------|---------|-------------------|
| pm.md | 76 | Operator-Owned Files | Escalate via objection |
| dev.md | 47 | Implementation Rules | Blocking objection → human |
| qa.md | 54 | Write Boundaries | Blocking objection → human |
| eng_director.md | 59 | Write Boundaries | Architectural decisions cannot override; route to human |

`agentxchain.json` verified unchanged via `git diff HEAD -- agentxchain.json` (empty diff). Timeouts (`per_turn_minutes: 120`) and watch routes (2 routes) confirmed intact via JSON parse.

### Independent Verification

| Test Suite | Count | Result |
|------------|-------|--------|
| local-cli-adapter.test.js | 46 | PASS |
| claude-local-auth-smoke-probe.test.js | 8 | PASS |
| agentxchain-config-schema.test.js | 7 | PASS |
| governed-state.test.js | 99 | PASS |
| dispatch-bundle.test.js | 74 | PASS |
| turn-result-validator + staged-result-proof | 114 | PASS |
| continuous-run.test.js | 87 | PASS |
| vision-reader.test.js | 36 | PASS |
| timeout-evaluator + run-loop + release-notes-gate | 80 | PASS |
| dispatch-bundle-decision-history.test.js | 10 | PASS (fixed this turn) |
| **Total** | **561 pass / 0 failures** | |

### Pre-existing Non-blocking

- AGENT-TALK guard: 3/8 fail (tests 4-6). Same 3 tests failing across 10+ consecutive QA runs. TALK.md state issue from prior runs, not a regression.
- Broader test suite (6911 total) has ~28 additional failures: 6 timeouts, 7 artifact-validation cascades, 9 delegation-chain cascades, 3 MCP/remote/E2E environment-dependent. All pre-existing at committed baseline (verified via `git stash` + test).

## Open Blockers

None.

## Conditions

None. Ship as-is.
