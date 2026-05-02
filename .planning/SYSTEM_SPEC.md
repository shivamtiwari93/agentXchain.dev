# System Spec — M4 Recovery Path Audit

**Run:** `run_24a851cc6e95d841`
**Baseline:** git:0d2572be811bc90097d51baed103a612b199a2f6
**Package version:** `agentxchain@2.155.72`

## Purpose

Comprehensive audit of all recovery paths in the agentXchain orchestrator, covering four failure domains: ghost recovery, budget exhaustion, credential failure, and process crash. This audit identifies every recovery entry point, its state transitions, checkpoint coverage, event emissions, and gaps.

**Scope:** Audit and classification only. No code changes. Gaps identified here inform subsequent M4 items (structured recovery classification, checkpoint-restore hardening, cost tracking).

---

## 1. Ghost Recovery Paths

### 1.1 Recovery Entry Points

| # | Function | File:Line | Trigger | Retry Budget |
|---|----------|-----------|---------|--------------|
| 1 | `maybeAutoRetryGhostBlocker()` | continuous-run.js:914 | `blocked_reason.category === 'ghost_turn'` | Per-run counter (default 3) |
| 2 | `maybeAutoRetryRetainedClaudeAuthDispatch()` | continuous-run.js:528 | `blocked_on === 'dispatch:claude_auth_failed'` + env auth present | Unlimited (env-driven) |
| 3 | `reclassifyRetainedClaudeNodeIncompatGhost()` | continuous-run.js:404 | Node incompatibility ghost + `local_cli` runtime | One-shot (config-driven) |
| 4 | `maybeAutoRetryProductiveTimeoutBlocker()` | continuous-run.js:747 | `retries_exhausted` + timeout signature + productive turn | Per-run max 1, 120min deadline |

### 1.2 Shared Recovery Mechanism: `clearGhostBlockerAfterReissue()`

**Location:** continuous-run.js:631-642

All 4 recovery paths call `clearGhostBlockerAfterReissue()` after `reissueTurn()`. This function:

1. Writes `state.json` via `writeGovernedState()` — sets `status: 'active'`, clears `blocked_on/blocked_reason/escalation`
2. Writes `session.json` via `writeSessionCheckpoint(root, nextState, 'blocker_cleared')` — BUG-115 fix
3. Returns cleaned state to caller

**Callers then:** update continuous-session.json via `writeContinuousSession()` and emit recovery event.

### 1.3 Ghost Detection: `classifyGhostRetryDecision()`

**Location:** ghost-retry.js:229-319

Decision outcomes:
- `"retry"` — attempts < maxRetries, no signature repeat
- `"exhausted"` — budget depleted OR N consecutive identical fingerprints (threshold=2)
- `"skip_non_ghost"` — not actually a ghost_turn
- `"disabled"` — auto_retry_on_ghost.enabled is false
- `"missing_active_ghost"` — blocked_reason names ghost but no eligible turn found
- `"missing_run_id"` — cannot scope retry counter

### 1.4 Ghost Exhaustion Path

**Location:** continuous-run.js:1005-1073

When retry budget depleted:
1. Builds diagnostic bundle via `buildGhostRetryDiagnosticBundle()` (ghost-retry.js:506)
2. Updates `state.json` with exhaustion detail in `blocked_reason.recovery.detail`
3. Updates `continuous-session.json` with `status: 'paused'`, `exhausted: true`
4. Emits `ghost_retry_exhausted` event with full diagnostic payload

### 1.5 Main Loop Recovery Guard

**Location:** continuous-run.js:2576

After BUG-115 fix: if `step.status === 'failed'` but `isGovernedRunStillActiveForSession()` returns true, session recovers to `'running'` and loop continues. Prevents premature session exit when governed run is still active.

### 1.6 State File Write Order (Ghost Retry)

```
1. reissueTurn()           → state.json (new turn, old archived)
2. clearGhostBlockerAfterReissue() → state.json (active), session.json (blocker_cleared)
3. applyGhostRetryAttempt() → in-memory session update only
4. writeContinuousSession() → continuous-session.json (ghost_retry counter)
5. emitRunEvent()           → run-events.json (non-fatal)
```

### 1.7 Ghost Recovery Gaps

| Gap ID | Description | Severity | Impact |
|--------|-------------|----------|--------|
| G-GHOST-1 | No try-catch around `writeGovernedState()` in recovery paths | medium | Partial recovery: reissued turn orphaned in blocked state if state write fails |
| G-GHOST-2 | No try-catch around `writeContinuousSession()` in recovery paths | medium | Session believes recovery succeeded; state shows blocked |
| G-GHOST-3 | No idempotency guard on reissue | low | Rapid re-invocations could spawn duplicate recovery attempts |
| G-GHOST-4 | Multi-step write without rollback | medium | If step 2 fails after step 1, turn creation is orphaned |

---

## 2. Budget Exhaustion Paths

### 2.1 Budget Tracking Layers

| Layer | Location | Fields | Scope |
|-------|----------|--------|-------|
| Per-run | governed-state.js:831-894 | `budget_status.spent_usd`, `remaining_usd`, `exhausted` | Single governed run |
| Per-session | continuous-run.js:1993-1999 | `session.cumulative_spent_usd`, `per_session_max_usd` | Continuous session |
| Per-turn reservation | governed-state.js:3571-3587 | `budget_reservations[turnId].reserved_usd` | Turn assignment |

### 2.2 Budget Enforcement Points

| # | Check | Location | Policy: `pause_and_escalate` | Policy: `warn` |
|---|-------|----------|------------------------------|-----------------|
| 1 | Pre-assignment: `remaining_usd <= 0` | governed-state.js:3562 | Reject turn assignment | Allow with warning |
| 2 | Pre-assignment: `estimatedCost > available` | governed-state.js:3575 | Reject with reservation error | Allow |
| 3 | Post-acceptance: `remaining_usd <= 0` | governed-state.js:5465 | Block run (`budget:exhausted`) | Set `warn_mode`, continue |
| 4 | Session-level: `cumulative >= max` | continuous-run.js:1993 | Terminal stop (`session_budget`) | N/A |

### 2.3 Budget Exhaustion Blocked State

**Location:** governed-state.js:5474-5488

On `pause_and_escalate` (default):
- `status: 'blocked'`, `blocked_on: 'budget:exhausted'`
- `blocked_reason.category: 'budget_exhausted'`
- `recovery.owner: 'human'`
- `recovery.recovery_action: 'Increase budget with agentxchain config --set budget.per_run_max_usd <usd>, then run agentxchain resume'`
- Session checkpoint written with reason `'blocked'`

### 2.4 Budget Recovery Path

1. Operator increases budget: `agentxchain config --set budget.per_run_max_usd <new_amount>`
2. Next state load calls `reconcileBudgetStatusWithConfig()` (governed-state.js:868)
3. Recalculates `remaining_usd = new_limit - spent_usd`
4. If positive: recovery_action updates to "Run agentxchain resume"
5. Operator runs `agentxchain resume` → normal turn assignment proceeds

### 2.5 Budget Recovery Gaps

| Gap ID | Description | Severity | Impact |
|--------|-------------|----------|--------|
| G-BUDGET-1 | Session budget (`session_budget` status) is terminal — no recovery path | high | Continuous loops cannot resume after session budget exhaustion; operator must start new session |
| G-BUDGET-2 | `warn_mode` never clears after budget increase | low | Audit/reporting confusion: warnings persist after recovery |
| G-BUDGET-3 | No event emitted on budget recovery success | medium | No audit trail when budget exhaustion is resolved |
| G-BUDGET-4 | No checkpoint on pre-assignment budget rejection | low | State narrative incomplete (assignment rejection not recorded) |
| G-BUDGET-5 | No per-individual-run budget limit within continuous sessions | low | Cannot cap cost of single run without capping entire session |

---

## 3. Credential Failure Paths

### 3.1 Detection Mechanisms

| Layer | Location | Mechanism |
|-------|----------|-----------|
| Preflight | local-cli-adapter.js:165 | `getClaudeSubprocessAuthIssue()` smoke probe before spawn |
| Post-dispatch | local-cli-adapter.js:505-537 | Auth regex on subprocess logs after exit |
| Retained session | continuous-run.js:326-400 | Dispatch log scan on continuous restart |

**Auth pattern:** `CLAUDE_AUTH_FAILURE_RE` at claude-local-auth.js:14 — matches `authentication_failed|authentication_error|invalid authentication credentials|unauthorized|API Error: 401`

### 3.2 Classification Paths

| Path | Entry Point | Classification | Auto-Recovery |
|------|-------------|----------------|---------------|
| Fresh dispatch failure | local-cli-adapter.js:506 | `error_class: 'claude_auth_failed'` | No (manual env fix) |
| Retained escalation reclassification | continuous-run.js:357 | `dispatch:claude_auth_failed` (from `retries_exhausted`) | No |
| Retained auth auto-retry | continuous-run.js:528 | Already classified | Yes (if env has fresh creds) |

### 3.3 Credential Recovery Flow

```
BLOCKED: dispatch:claude_auth_failed
  → Operator exports ANTHROPIC_API_KEY=fresh-key
  → agentxchain run --continue (or next continuous cycle)
  → advanceContinuousRunOnce() startup sequence:
    1. maybeReclassifyRetainedClaudeAuthEscalation() — reclassify if needed
    2. maybeAutoRetryRetainedClaudeAuthDispatch() — checks hasClaudeEnvAuth(process.env)
    3. If env auth present: reissueTurn() + clearGhostBlockerAfterReissue()
    4. Session resumes running
```

### 3.4 Credential vs Ghost Distinction

- Credential failures classified at adapter layer, bypass ghost retry budget
- `maybeAutoRetryRetainedClaudeAuthDispatch()` runs BEFORE ghost retry checks
- No retry budget — single-shot env-driven recovery per blocked state

### 3.5 Credential Recovery Gaps

| Gap ID | Description | Severity | Impact |
|--------|-------------|----------|--------|
| G-CRED-1 | Reclassification (`maybeReclassifyRetainedClaudeAuthEscalation`) writes `state.json` but no session checkpoint | low | Session may not reflect reclassification until next state write |
| G-CRED-2 | No mid-session credential refresh detection | medium | If creds become stale during long run, no auto-detection until next startup |
| G-CRED-3 | Codex auth failure path less mature than Claude path | low | No corresponding BUG tracking for Codex; recovery guidance generic |
| G-CRED-4 | Auth env check happens at startup only (once per `advanceContinuousRunOnce()`) | medium | If operator refreshes creds mid-run, not picked up until next cycle |

---

## 4. Process Crash Paths

### 4.1 Subprocess Crash Detection

**Location:** local-cli-adapter.js:455-605

- `child.on('close', (exitCode, killSignal))` detects termination
- Signals tracked: SIGTERM, SIGKILL
- If staged result exists on disk → turn accepted regardless of exit code
- If no staged result → turn rejected, classified by failure type

### 4.2 Orchestrator Crash Recovery: Acceptance Transaction Journal

**Location:** governed-state.js:1262-1316 (`replayPreparedJournals`)

**Mechanism:**
1. Journal created BEFORE state mutation (governed-state.js:6159)
2. Written to `.agentxchain/transactions/accept/{transaction_id}.json` with `status: 'prepared'`
3. Contains: `history_entry`, `ledger_entries`, `next_state`

**Commit order:** `history → ledger → repo-decisions → talk → state → cleanup → journal delete`

**Recovery on next startup:**
- `replayPreparedJournals()` scans for `'prepared'` journals
- **Path A:** State commit already succeeded → cleanup only (remove staging/dispatch dirs)
- **Path B:** State commit never happened → full replay from journal (history + ledger + state)
- Idempotent: sequence check detects already-applied entries

### 4.3 Lock File Management

**Location:** governed-state.js:1199-1240

- Lock file: `.agentxchain/locks/accept-turn.lock`
- Contains: `{ owner_pid, acquired_at }`
- Stale detection: `STALE_LOCK_TIMEOUT_MS = 30_000` — reclaimed if owner process dead OR 30s elapsed
- Uses `process.kill(pid, 0)` signal test for liveness check
- Release in `finally` block of `acceptGovernedTurn()` (line 4114-4117)

### 4.4 Graceful Shutdown Handlers

| Command | Handler | Mechanism |
|---------|---------|-----------|
| `run` | commands/run.js:219-232 | First SIGINT: finish current turn; Second SIGINT: abort + exit(130) |
| `run --continuous` | continuous-run.js:2564-2627 | SIGINT sets `stopping = true`, loop exits cleanly |
| `run-chain` | lib/run-chain.js:104-106 | SIGINT sets `aborted = true`, terminal reason `'operator_abort'` |

### 4.5 Continuous Session Crash Recovery

**Location:** continuous-run.js:146-152 (`canResumeExistingContinuousSession`)

- On restart: reads `continuous-session.json`
- Resume conditions: status is `'paused'` or `'running'`, vision_path matches
- `isGovernedRunStillActiveForSession()` checks if governed run is still active
- If active → session recovers to `'running'`; if not → session stays terminal

### 4.6 Process Crash Gaps

| Gap ID | Description | Severity | Impact |
|--------|-------------|----------|--------|
| G-CRASH-1 | No `process.on('uncaughtException')` or `process.on('unhandledRejection')` handlers | high | Unexpected errors crash without cleanup; lock files, session state left inconsistent |
| G-CRASH-2 | Lock acquisition not atomic (read-check-overwrite race) | low | Two processes could both reclaim stale lock simultaneously (theoretical; same-machine PID check mitigates) |
| G-CRASH-3 | Subprocess output lost if orchestrator crashes before `saveDispatchLogs` | medium | Dispatch logs captured in memory, written after adapter returns; orchestrator crash loses diagnostic context |
| G-CRASH-4 | Journal replay assumes history/ledger appends are idempotent | low | If journal deletion fails after replay, entries duplicated on next replay |
| G-CRASH-5 | No automatic re-dispatch after subprocess crash | medium | Operator must manually run `agentxchain step --resume`; continuous mode does not auto-resume crashed single runs |
| G-CRASH-6 | `advanceContinuousRunOnce()` has no handled top-level failure path (try/finally exists but no catch) | medium | Unexpected errors propagate after SIGINT handler removed, crashing entire continuous loop |

---

## 5. Cross-Cutting Findings

### 5.1 Session Checkpoint Coverage Matrix

| State Transition | state.json | session.json | continuous-session.json | Event |
|-----------------|------------|--------------|------------------------|-------|
| Ghost retry success | YES | YES (blocker_cleared) | YES | auto_retried_ghost |
| Ghost retry exhaustion | YES | NO | YES (paused) | ghost_retry_exhausted |
| Claude auth retry | YES | YES (blocker_cleared) | YES | auto_retried_ghost |
| Claude auth reclassification | YES | NO | NO | retained_claude_auth_escalation_reclassified |
| Node incompat retry | YES | YES (blocker_cleared) | YES | auto_retried_ghost |
| Productive timeout retry | YES (2x) | YES (blocker_cleared) | YES | auto_retried_productive_timeout |
| Budget exhaustion block | YES | YES (blocked) | NO | budget_exceeded_warn (warn only) |
| Budget recovery (resume) | YES | YES (turn_assigned) | NO | NONE |
| Session budget terminal | NO | NO | YES (session_budget) | NONE |
| Main loop recovery | NO | NO | YES (running) | session_failed_recovered_active_run |

### 5.2 Write Error Handling Summary

**Critical finding:** Most recovery path writes are NOT wrapped in try-catch:

- `writeGovernedState()` — no error handling in callers
- `writeContinuousSession()` — no error handling in callers
- `writeSessionCheckpoint()` — has internal try-catch, logs warning only (silent unless `AGENTXCHAIN_DEBUG`)
- `emitRunEvent()` — has try-catch, non-fatal (correct behavior)

**safeWriteJson atomicity:** Uses temp-file + rename pattern (POSIX atomic rename). Failure propagates to caller as exception.

### 5.3 Consolidated Gap Priority

| Priority | Gap IDs | Theme | Recommendation |
|----------|---------|-------|----------------|
| P1 (high) | G-CRASH-1, G-CRASH-6 | Unhandled errors crash without cleanup | Add top-level exception/rejection handlers in continuous loop |
| P1 (high) | G-BUDGET-1 | Session budget is terminal | Add recovery path for session budget increase |
| P2 (medium) | G-GHOST-1, G-GHOST-2, G-GHOST-4 | Recovery write failures leave inconsistent state | Wrap critical writes in try-catch with rollback-on-failure |
| P2 (medium) | G-CRASH-3, G-CRASH-5 | Crash diagnostic loss + no auto-resume | Persist dispatch logs before adapter return; auto-resume in continuous mode |
| P2 (medium) | G-BUDGET-3, G-CRED-2, G-CRED-4 | Missing events/detection for recovery transitions | Emit recovery success events; mid-run credential refresh check |
| P3 (low) | G-GHOST-3, G-CRASH-2, G-CRASH-4, G-BUDGET-2, G-BUDGET-4, G-CRED-1, G-CRED-3 | Edge cases and polish | Address in subsequent M4 items |

---

## Dev Charter

### Deliverable

Dev verifies audit accuracy by confirming each identified gap exists in the code (grep/read verification). Produces `.planning/recovery-audit-evidence.md` with line-number evidence for each gap. No code changes in this run — code fixes are subsequent M4 items.

### Verification Checklist

1. Confirm G-GHOST-1: no try-catch around `writeGovernedState()` at continuous-run.js:639
2. Confirm G-GHOST-2: no try-catch around `writeContinuousSession()` at continuous-run.js:969
3. Confirm G-BUDGET-1: `session_budget` status is terminal at continuous-run.js:1993-1999
4. Confirm G-CRASH-1: no `process.on('uncaughtException')` in continuous-run.js
5. Confirm G-CRASH-6: `advanceContinuousRunOnce()` call at continuous-run.js:2574 has no surrounding try-catch
6. Confirm all 4 `clearGhostBlockerAfterReissue()` callers listed in Section 1.2

### Out of Scope

- Code changes (subsequent M4 items: structured classification, checkpoint-restore, cost tracking)
- New tests (follow-up implementation runs)
- Cold-start resume of failed sessions (deferred)

## Interface

This is an audit-only milestone — no new public interfaces are introduced. The recovery paths documented above expose the following internal orchestrator interfaces that downstream M4 items will harden:

- **Ghost recovery**: `reissueTurn()`, `clearGhostBlockerAfterReissue()`, `maybeAutoRetryGhostBlocker()` in `continuous-run.js`
- **Budget exhaustion**: Session budget enforcement in `continuous-run.js`, budget reconciliation in `governed-state.js`
- **Credential failure**: `maybeAutoRetryRetainedClaudeAuthDispatch()`, `hasClaudeEnvAuth()` in `continuous-run.js`
- **Process crash**: `runContinuous()` try/finally, adapter crash detection in `local-cli-adapter.js`, dispatch log persistence

## Acceptance Tests

- [x] All 4 recovery domains audited with entry points, state transitions, and gaps documented
- [x] Dev confirms each P1/P2 gap exists at cited line numbers <!-- turn_1937bcae8396a288: all 11 P1/P2 gaps verified with grep evidence in .planning/recovery-audit-evidence.md -->
- [ ] `npm run test` passes with no regressions (verification-only run, no code changes expected)
