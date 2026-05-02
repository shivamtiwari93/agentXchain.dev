# M4 Recovery Audit Evidence

**Run:** `run_24a851cc6e95d841`
**Turn:** `turn_1937bcae8396a288`
**Role:** dev
**Date:** 2026-05-02

## Challenge to Prior Turn

The PM charter is directionally correct, but it under-counts the verification scope. `.planning/SYSTEM_SPEC.md` lists 11 high/medium recovery gaps, while `.planning/PM_SIGNOFF.md` says QA should expect "9 gaps total" and the dev notes enumerate only 6 specific checks. I treated the system spec as authoritative and verified all high/medium gaps.

I also tightened one wording issue: G-CRASH-6 is not "no try block" around the continuous loop. `runContinuous()` has `try/finally` cleanup at `continuous-run.js:2572-2627`, but no `catch`; an exception from `advanceContinuousRunOnce()` still propagates after the SIGINT handler is removed. The verified gap is therefore "no handled top-level failure path."

## Evidence Summary

| Gap ID | Severity | Verification | Evidence |
|---|---:|---|---|
| G-GHOST-1 | medium | Confirmed | `clearGhostBlockerAfterReissue()` calls `writeGovernedState()` at `cli/src/lib/continuous-run.js:639`; there is no surrounding `try/catch` in lines 631-641. |
| G-GHOST-2 | medium | Confirmed | `maybeAutoRetryGhostBlocker()` writes the continuous session at `cli/src/lib/continuous-run.js:969` after reissue and blocker clear; lines 923-980 show no `try/catch` around the recovery write sequence. |
| G-GHOST-4 | medium | Confirmed | Ghost retry calls `reissueTurn()` at `cli/src/lib/continuous-run.js:926` and then `clearGhostBlockerAfterReissue()` at line 938. The recovery sequence has no rollback if the second write path fails. Productive-timeout retry has the same pattern at lines 780 and 790. |
| G-BUDGET-1 | high | Confirmed | Session budget exhaustion sets `session.status = 'session_budget'`, writes the session, and returns terminal status at `cli/src/lib/continuous-run.js:1993-1999`; the main loop treats `session_budget` as terminal at `continuous-run.js:2594-2599`. |
| G-BUDGET-3 | medium | Confirmed | Budget reconciliation updates blocked budget state in `cli/src/lib/governed-state.js:831-890`, but no recovery event is emitted there. Event search found budget block/warn events, not a budget recovery success event. |
| G-CRED-2 | medium | Confirmed | Credential auto-retry is evaluated from a blocked startup state at `cli/src/lib/continuous-run.js:2007-2012`. During active governed execution, lines 2374-2394 only catch thrown run failures; there is no mid-run credential refresh path. |
| G-CRED-4 | medium | Confirmed | `maybeAutoRetryRetainedClaudeAuthDispatch()` checks `hasClaudeEnvAuth(process.env)` once at `cli/src/lib/continuous-run.js:528-530`, and its only continuous-run invocation is the startup blocked-state path at lines 2007-2012. |
| G-CRASH-1 | high | Confirmed | `grep -RInE "process\\.on\\(['\\\"](uncaughtException\|unhandledRejection)['\\\"]" cli/src cli/bin` returned no matches. Existing process handlers cover SIGINT only, for example `continuous-run.js:2564-2570`. |
| G-CRASH-3 | medium | Confirmed | Adapter logs are accumulated in memory from stdout/stderr at `cli/src/lib/adapters/local-cli-adapter.js:365-383` and `process_exit` is appended at lines 455-502. `saveDispatchLogs()` persists them later at lines 652-658, so an orchestrator crash before that call can lose buffered diagnostics. |
| G-CRASH-5 | medium | Confirmed | If a subprocess exits without a staged result, the adapter returns failure at `cli/src/lib/adapters/local-cli-adapter.js:595-603`. Continuous execution then pauses on blocked runs at `continuous-run.js:2413-2440` unless a ghost/productive-timeout retry applies; broad crash re-dispatch was not found in source search. |
| G-CRASH-6 | medium | Confirmed with wording correction | `runContinuous()` calls `await advanceContinuousRunOnce(...)` at `cli/src/lib/continuous-run.js:2574` inside `try/finally` but has no `catch` before `finally` at lines 2625-2627. Unexpected errors are not converted into a failed session result at this level. |

## Commands Used

```sh
grep -nE "function clearGhostBlockerAfterReissue|writeGovernedState\\(|writeContinuousSession\\(|reissueTurn\\(|maybeAutoRetryGhostBlocker|maybeAutoRetryProductiveTimeoutBlocker|session_budget|advanceContinuousRunOnce|process\\.on\\('uncaughtException'|process\\.on\\('unhandledRejection'|unhandledRejection|uncaughtException" cli/src/lib/continuous-run.js
grep -nE "saveDispatchLogs|child\\.on\\('close'|dispatch_logs|stdout|stderr|claude_auth_failed|staged result|stagedResult|turn result" cli/src/lib/adapters/local-cli-adapter.js
grep -nE "budget recovery|reconcileBudgetStatusWithConfig|budget:exhausted|budget_exhausted|warn_mode|emitRunEvent|budget" cli/src/lib/governed-state.js cli/src/lib/continuous-run.js
grep -nE "maybeReclassifyRetainedClaudeAuthEscalation|maybeAutoRetryRetainedClaudeAuthDispatch|hasClaudeEnvAuth|writeGovernedState\\(|claude_auth_failed|codex|auth" cli/src/lib/continuous-run.js cli/src/lib/adapters/local-cli-adapter.js cli/src/lib/claude-local-auth.js
grep -RInE "process\\.on\\(['\\\"](uncaughtException|unhandledRejection)['\\\"]" cli/src cli/bin
grep -RInE "budget_(recovered|recovery)|run_budget_recovered|budget_exhaustion_resolved|session_budget_recovered" cli/src
grep -RInE "auto.*(redispatch|re-dispatch)|redispatch|reissueTurn\\(|auto_retry.*crash|subprocess.*crash|run_failed" cli/src cli/test
```

## Result

All high/medium M4 recovery gaps in `.planning/SYSTEM_SPEC.md` are supported by current source evidence. The planning gate files exist, and the audit baseline is sufficient to move from planning to implementation for hardening work.
