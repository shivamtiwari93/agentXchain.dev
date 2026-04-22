# BUG-61 Code Audit (Turn 199 — Claude Opus 4.7 research-pass)

**Status:** Research-only. No source changes, no DEC, no version bump. Matches the shape of `BUG_60_CODE_AUDIT.md`.

**HEAD at audit:** `4d2e3f00 docs(agent-talk): log turn 198 release` (`v2.154.1` shipped).

**Purpose:** Catalog what of the BUG-61 ghost-turn auto-recovery contract has shipped in code versus what remains. Closure still requires tester-quoted shipped-package evidence per HUMAN-ROADMAP acceptance; this audit does not flip the checkbox. It exists so the next implementation turn (if any is needed beyond tester quote-back) knows where to point.

---

## Contract recap (from HUMAN-ROADMAP BUG-61 + `BUG_61_GHOST_TURN_AUTO_RECOVERY_SPEC.md`)

Two fix paths, both ordered to ship:

1. **Automatic retry with bounded budget** — on ghost detection, reissue up to N times, track retry count in state, escalate with diagnostic bundle if exhausted.
2. **Faster-fail diagnostic surface** — on manual reissue path, surface actionable output (subprocess exit code, captured stderr, spawn env presence, resolved binary path, effective watchdog threshold).

Acceptance: tester quotes `auto_retried_ghost` event in `.agentxchain/events.jsonl` followed by a successful subsequent turn on a shipped version, no operator `reissue-turn` invocation.

---

## Shipped — Option 1 (automatic retry) is wired

### Decision helper (`cli/src/lib/ghost-retry.js`)

- `GHOST_FAILURE_TYPES = ['runtime_spawn_failed', 'stdout_attach_failed']` (`ghost-retry.js:24-27`).
- `findPrimaryGhostTurn(state)` (`:157-178`): requires `blocked_reason.category === 'ghost_turn'` AND an active turn with `status === 'failed_start'` AND `failed_start_reason` in `GHOST_FAILURE_TYPES` AND no meaningful staged result. Matches the spec's ghost-eligibility definition exactly.
- `classifyGhostRetryDecision({ state, session, autoRetryOnGhost, runId })` (`:223-313`): returns one of `retry | exhausted | skip_non_ghost | missing_active_ghost | disabled | missing_run_id` with `{reason, attempts, maxRetries, retryState, ghost?, signatureRepeat?}`. Same-signature early stop fires at `SIGNATURE_REPEAT_THRESHOLD = 2` consecutive identical fingerprints `(runtime_id, role_id, failure_type)` (`:44, :108-113, :124-142, :288-303`).
- Fingerprint log capped at 10 entries (`applyGhostRetryAttempt:350`), preserved into the exhausted state (`applyGhostRetryExhaustion:384`).
- Diagnostic bundle builder `buildGhostRetryDiagnosticBundle(sessionOrState)` (`:430-447`) emits `{attempts_log, fingerprint_summary, final_signature}` for event payload + CLI surface.
- Exhaustion mirror string `buildGhostRetryExhaustionMirror` distinguishes raw-budget exhaustion from pattern-based early stop (`:398-414`).

### Watchdog → ghost classification (`cli/src/lib/stale-turn-watchdog.js`)

- `detectGhostTurns()` + `reconcileStaleTurns()` transition eligible turns to `failed_start` with `failed_start_reason` / `failed_start_threshold_ms` / `failed_start_running_ms` set (`:381-386`).
- `buildBlockedStateFromEntries()` (`:418-421`) writes `category: 'ghost_turn'`, `turn_id`, typed `failed_start` vocabulary — exactly the shape `findPrimaryGhostTurn` keys on.
- Typed event emission `runtime_spawn_failed` / `stdout_attach_failed` at `:357-358` and resolved-vs-fallback failure-type logic at `:469-500`.

### Continuous loop wiring (`cli/src/lib/continuous-run.js`)

- `resolveContinuousOptions` (`:583-627`) computes `autoRetryOnGhost: {enabled, maxRetriesPerRun, cooldownSeconds}` from CLI flag → config → full-auto default. Default-on when `isFullAutoApprovalPolicy(config)` returns true AND `--continuous` is set (`:587-590`). Matches the Turn 175 REVISED posture in the spec (primitive default `false`, full-auto opt-in via resolver).
- `maybeAutoRetryGhostBlocker` (`:156-309`) is the single retry path:
  - Calls `classifyGhostRetryDecision`.
  - On `retry`: invokes `reissueTurn(root, config, {turnId, reason: 'auto_retry_ghost'})` (`:168-171`), clears the ghost blocker (`clearGhostBlockerAfterReissue`), updates session via `applyGhostRetryAttempt`, emits `auto_retried_ghost` event with payload `{old_turn_id, new_turn_id, failure_type, attempt, max_retries_per_run, runtime_id, running_ms, threshold_ms}` (`:205-221`), respects `cooldownSeconds`.
  - On `exhausted`: writes `blocked_reason.recovery.detail` mirror, applies `applyGhostRetryExhaustion`, emits `ghost_retry_exhausted` with `{attempts, max_retries_per_run, failure_type, runtime_id, exhaustion_reason, signature_repeat, diagnostic_bundle, diagnostic_refs.recovery_action}` (`:282-301`).
- Four call sites in `advanceContinuousRunOnce`: `:693` (paused-session guard), `:732` (post-resume block), `:790` (active-governed-run block), `:960` (fresh-intent block). Each follows the same pattern: detect blocked → call `maybeAutoRetryGhostBlocker` → return its result if non-null → otherwise fall through to existing paused/blocked handling.

### Event vocabulary (`cli/src/lib/run-events.js`)

- `auto_retried_ghost` (`:47`) and `ghost_retry_exhausted` (`:48`) are registered event types.

### Test coverage

- `cli/test/ghost-retry.test.js` — pure decision helper contract (14 tests locally).
- `cli/test/continuous-ghost-retry-e2e.test.js` — end-to-end command-chain behavior.
- Combined local run 2026-04-22: `47 tests / 16 suites / 47 pass / 0 fail` in ~37.7s.
- Related regressions still green: `bug-27-restart-ghost-turn.test.js`, `coordinator-retry-e2e.test.js`, `e2e-coordinator-retry-real-agent.test.js`, `e2e-governed-reject-retry.test.js`.

---

## Shipped — Option 2 (diagnostic surface) is mostly present

The manual reissue path already attaches most of the Option 2 diagnostic list:

- **Subprocess exit code / signal:** `local-cli-adapter.js` captures `exitCode` and `signal` in the diagnostic log chain via `appendDiagnostic` (adapter owns the capture; surfaced in `.agentxchain/dispatch/<turn>/logs/`).
- **Captured stderr:** adapter tracks `stderrBytes` and `stderrExcerpt` at spawn time (`local-cli-adapter.js:193-195`) and includes them in the exit/timeout diagnostic records.
- **Resolved binary path + args:** `spawn_prepare` diagnostic (`local-cli-adapter.js:157-166`) records `{command, args (redacted), cwd, prompt_transport, stdin_bytes, env}`.
- **Spawn env boolean-presence:** `pickDiagnosticEnv(spawnEnv)` plumbs the safe env shape into the diagnostic record.
- **Watchdog threshold effective at dispatch time:** surfaced on the `failed_start` turn as `failed_start_threshold_ms` (`stale-turn-watchdog.js:385`) and mirrored into the `ghost_retry_exhausted` event payload as `threshold_ms`.

**Where Option 2 still thin (gaps, not blockers for closure acceptance):**

1. The `ghost_retry_exhausted` event diagnostic bundle (`buildGhostRetryDiagnosticBundle`) surfaces `{attempts_log, fingerprint_summary, final_signature}` but does NOT inline the adapter's captured stderr excerpt or subprocess exit code for each attempt — those live only in the per-turn dispatch log files. Operators reading `events.jsonl` alone see the fingerprint pattern but have to cross-reference the dispatch logs for stderr. A future slice could fold `stderr_excerpt` + `exit_code` + `resolved_command` into each `attempts_log[]` entry so the event payload is self-contained.
2. Today the manual reissue path (`agentxchain reissue-turn --reason ghost`) does not print the diagnostic bundle to stdout — the operator must look at `events.jsonl` and dispatch logs separately. A small CLI surface improvement would print a one-screen summary of the last ghost attempt's key fields on reissue.

Neither gap blocks the BUG-61 acceptance (ghost → `auto_retried_ghost` → success). Both would improve the operator-facing diagnostic quality after the acceptance lands.

---

## Verified — no coordinator-layer duplication

Grep for `failed_start|ghost|reissueTurn` across `cli/src/lib/` returns 9 files, none under `coordinator-*.js`. Ghost retry is cleanly scoped to the continuous loop layer; the coordinator does not need to be aware of it because ghost classification happens upstream (watchdog) and retry happens downstream (continuous step). No cross-layer reentrancy to audit.

---

## Not verified — things this audit cannot confirm without tester

1. **Shipped-package behavior matches source-tree behavior.** The implementation is on HEAD as of `v2.154.1`, but the HUMAN-ROADMAP acceptance is tester-quoted output on a ghost on a real project. No tester evidence on auto-retry has landed since the wiring shipped. This is the same closure-gate pattern as BUG-52 / BUG-53 / BUG-54 / BUG-59 / BUG-62.
2. **Default-on resolution under tester's real `agentxchain.json`.** If the tester's project does NOT satisfy `isFullAutoApprovalPolicy` (`policy.phase_transitions?.default === 'auto_approve' && policy.run_completion?.action === 'auto_approve'`), the primitive default is `enabled: false` and auto-retry will NOT engage. A project with `phase_transitions.default === 'human_approval'` plus continuous mode does not get auto-retry; the ghost still surfaces the current manual `reissue-turn` recovery. This is intentional per the Turn 175 REVISED posture, but it means the BUG-61 closure-acceptance quote-back MUST come from a project whose approval_policy is already full-auto. A tester using delegated human approval (the same shape that exposed BUG-52 third variant) will NOT trigger the auto-retry path and their report will look like "BUG-61 not fixed" when the code is behaving correctly per spec. Worth calling out in the tester runbook update before acceptance.
3. **BUG-54 watchdog fix interaction.** v2.151.0 raised the default `startup_watchdog_ms` (per HUMAN-ROADMAP BUG-54 "Updated diagnosis"). The tester's ghost evidence that motivated BUG-61 was based on 30s watchdog; most of those durations (58s, 101s) would no longer classify as ghosts under the post-v2.151.0 threshold. BUG-61 auto-retry may therefore fire less often in practice, which is the correct outcome (fewer false ghosts, fewer retries needed) but makes the tester quote-back harder to obtain because the trigger is rarer. Both the tester runbook + BUG-61 roadmap entry already acknowledge this.

---

## Recommendation for next execution turn

1. **Do NOT reopen implementation.** All six BUG-61 fix requirements from HUMAN-ROADMAP are met in code. Implementation is complete through v2.154.1.
2. **Update tester runbook** (not done this turn) so the ghost-reproduction request explicitly names the approval-policy precondition: full-auto approval_policy + continuous mode. Without that, the auto-retry path is disabled by design and the tester's evidence will misclassify as "not fixed."
3. **Optional diagnostic-surface follow-up** (Option 2 polish): fold adapter stderr excerpt + exit code into `attempts_log[]` entries so `events.jsonl` is self-contained. Size: small. Can ship as a standalone patch after BUG-61 closure, not a blocker.
4. **Closure gate** remains tester-quoted `auto_retried_ghost` → subsequent success on a shipped version. No source change closes BUG-61 without that evidence.
