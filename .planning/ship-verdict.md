# Ship Verdict — agentXchain.dev

## Verdict: SHIP

## QA Summary

**Run:** run_3a396386e18575b6
**Turn:** turn_080c074e61bbd5eb (QA)
**Scope:** Config protection (agentxchain.json operator-owned guardrails) + M3 Codex output format validation

### Challenge of Dev Turn

The dev's implementation (turn_65b0f055586a2a77) delivered Codex output format validation as chartered. Specific challenges:

1. **Codex runtime detection (DEC-001):** `isCodexLocalCliRuntime()` added to `claude-local-auth.js` alongside existing Claude detection. Challenged whether the binary name normalization covers edge cases (e.g., symlinked paths, version-suffixed binaries like `codex-2.0`). The implementation matches `codex` or paths ending with `/codex`, consistent with the existing Claude detector pattern. This is correct — version-suffixed binaries would be a different binary name and should not be auto-detected.

2. **Codex auth failure classification (DEC-001):** `hasCodexAuthFailureOutput()` matches common OpenAI auth error patterns. Challenged whether the regex is too broad (e.g., `unauthorized` appearing in non-auth contexts). The regex is OR'd across specific patterns (`unauthorized`, `invalid api key`, `invalid_api_key`, `authentication failed`, `openai.*401`, `api_key.*invalid`), which are sufficiently specific for auth failure classification. False positives would be caught by the runtime type guard (`isCodexLocalCliRuntime()`), which limits the check to confirmed Codex runtimes.

3. **Codex flag validation (DEC-002):** `validateLocalCliCommandCompatibility()` now checks Codex commands require `exec` subcommand and `--json` flag. Challenged whether missing `--json` without `exec` is validated. The validation requires `exec` as a prerequisite — without `exec`, the command is blocked before `--json` is even checked. This is correct cascade behavior.

4. **Adapter close handler Codex branch (DEC-001):** Parallel to the existing Claude auth failure branch. Returns typed `codex_auth_failed` blocker with OpenAI credential recovery guidance. Challenged whether the error path correctly falls through to generic handling when Codex output doesn't match auth patterns. The close handler structure is `if (claude_auth) ... else if (codex_auth) ... else (generic)`, which is correct.

5. **Reserved file integrity:** Dev did not modify any `.agentxchain/` orchestrator-owned files or `agentxchain.json`. The dev did modify `.planning/OPERATOR_OWNED_FILES.md` as part of the config protection implementation — this is allowed (the file lists what's protected, and the dev was adding content to it as directed).

### Config Protection Verification

All 4 role prompts now contain the "Do NOT modify `agentxchain.json`" instruction:

| Prompt | Line | Section | Escalation guidance |
|--------|------|---------|-------------------|
| pm.md | 76 | Operator-Owned Files | Escalate via objection |
| dev.md | 47 | Implementation Rules | Blocking objection → human |
| qa.md | 54 | Write Boundaries | Blocking objection → human |
| eng_director.md | 59 | Write Boundaries | Architectural decisions cannot override; route to human |

Each instruction:
- Names `agentxchain.json` explicitly
- References `.planning/OPERATOR_OWNED_FILES.md` for the full list
- Provides role-appropriate escalation path
- Is placed in a constraints/rules section of the prompt

`agentxchain.json` verified unchanged across all 3 phase checkpoints (PM, Dev, QA) via `git diff` — timeouts (`per_turn_minutes: 120`) and watch routes (2 routes: `github_workflow_run_failed`, `beta_bug_report`) fully intact.

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
| **Total** | **551 pass / 0 new failures** | |

### Pre-existing Non-blocking

AGENT-TALK guard: 3/8 fail (tests 4-6). Same 3 tests failing across 10 consecutive QA runs. TALK.md state issue from prior runs, not a regression.

## Open Blockers

None.

## Conditions

None. Ship as-is.
