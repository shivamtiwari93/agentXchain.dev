# BUG-61 Ghost-Turn Auto-Recovery Spec

**Status:** Draft implementation contract
**Owner:** GPT 5.4 (Codex), Turn 174
**Roadmap item:** HUMAN-ROADMAP BUG-61

## Purpose

BUG-61 removes mandatory operator intervention from the common ghost-turn recovery path. Today a ghost turn transitions to `failed_start`, blocks the run, and tells the operator to run `agentxchain reissue-turn --turn <id> --reason ghost`. That is correct diagnostic behavior for manual/governed operation, but it contradicts lights-out execution when the failure is transient and safely retryable.

The fix must preserve the existing BUG-51/BUG-54 startup-failure truth boundary while adding bounded automatic recovery for continuous/full-auto runs.

## Current Code Anchors

- `cli/src/lib/stale-turn-watchdog.js`
  - `detectGhostTurns()` classifies active turns with no startup proof after the startup watchdog threshold.
  - `reconcileStaleTurns()` transitions ghosts to `failed_start`, emits `turn_start_failed`, emits typed `runtime_spawn_failed` or `stdout_attach_failed`, and writes `run_blocked`.
  - `buildBlockedStateFromEntries()` sets `blocked_reason.recovery.owner = "human"` and a manual `reissue-turn` recovery action.
- `cli/src/lib/governed-state.js`
  - `reissueTurn()` already creates a fresh assigned turn from the old turn, releases the old budget reservation, creates a new reservation, appends history/decision-ledger rows, and emits `turn_reissued`.
- `cli/src/lib/continuous-run.js`
  - `advanceContinuousRunOnce()` treats blocked executions as terminal `status: "blocked"` and sets the continuous session to `paused`.
  - `executeContinuousRun()` exits the loop when a step returns `status: "blocked"`.
- Existing tests already lock the current manual behavior:
  - `cli/test/continuous-run-e2e.test.js` asserts ghost startup failures surface `reissue-turn` recovery.
  - `cli/test/claim-reality-preflight.test.js` asserts packaged ghost detection, `failed_start`, typed failure events, and manual recovery text.

## Interface

Add continuous-run configuration:

```json
{
  "run_loop": {
    "continuous": {
      "auto_retry_on_ghost": {
        "enabled": true,
        "max_retries_per_run": 3,
        "cooldown_seconds": 5
      }
    }
  }
}
```

Resolved options should expose:

```js
{
  autoRetryOnGhost: {
    enabled: boolean,
    maxRetriesPerRun: number,
    cooldownSeconds: number
  }
}
```

Default posture (REVISED 2026-04-22, Turn 175 Claude Opus 4.7 challenge):

- **Primitive default:** `enabled: false`. Auto-retry is opt-in at the config primitive level.
- **Full-auto opt-in:** when the resolved approval_policy posture is full-auto (routine gates default to `auto_approve` AND phase_transitions.default is `auto_approve` AND run_completion.action is `auto_approve`) AND continuous is enabled, the resolver promotes the default to `enabled: true` unless the config explicitly sets `enabled: false`.
- **CLI flag override:** `--auto-retry-on-ghost` / `--no-auto-retry-on-ghost` always wins over resolver-derived defaults.
- **Rationale:** the HUMAN-ROADMAP BUG-61 text literally says *"enabled by default for full-auto mode, disabled for manual mode."* GPT's Turn 174 proposal flipped that to `enabled: true` for ALL continuous mode. No code today distinguishes full-auto continuous from triage-manual continuous at a normalized-boolean level; silent auto-retry on a human-monitored continuous session is a behavior-change surprise and violates the principle of least astonishment. Defaulting the primitive off keeps the surprise-free posture; the resolver promotes to on only when the project's approval-policy posture is already full-auto.
- `max_retries_per_run` default: `3`.
- `cooldown_seconds` default: `5`.
- Manual `status`, `resume`, `step --resume`, and direct governed runs keep the existing manual recovery posture unless they explicitly execute through continuous auto-retry handling.

## Behavior

### Ghost Definition

For auto-retry eligibility, a ghost turn is:

1. A turn in `active_turns` whose status was transitioned to `failed_start`.
2. `failed_start_reason` is `runtime_spawn_failed` or `stdout_attach_failed`.
3. The same transition came from the startup watchdog / no-startup-proof path, not from an arbitrary operator mutation.
4. No meaningful staged result exists for the failed turn.

This spec intentionally keys on the existing BUG-51 typed startup-failure vocabulary. It must not broaden "ghost" to all blocked turns, stale turns, rejected turns, gate blockers, budget blockers, or credentialed approval gates.

### Automatic Retry Flow

When continuous execution returns a blocked state whose `blocked_reason.category === "ghost_turn"`:

1. Reload governed state from disk.
2. Identify the primary ghost turn from `blocked_reason.turn_id` or the active turn marked `failed_start`.
3. Check the run-scoped retry budget for the current `run_id`.
4. If budget remains, call `reissueTurn(root, config, { turnId, reason: "auto_retry_ghost" })`.
5. Record an `auto_retried_ghost` event with:
   - `run_id`
   - `old_turn_id`
   - `new_turn_id`
   - `failure_type`
   - `attempt`
   - `max_retries_per_run`
   - `runtime_id`
   - `running_ms`
   - `threshold_ms`
6. Set the continuous session back to `running`, keep the same `current_run_id`, and resume governed execution after the configured cooldown.

### Retry Budget

Retry budget is run-scoped, not turn-scoped.

Minimum persisted state shape:

```json
{
  "ghost_retry": {
    "run_id": "run_...",
    "attempts": 2,
    "max_retries_per_run": 3,
    "last_old_turn_id": "turn_...",
    "last_new_turn_id": "turn_...",
    "last_failure_type": "stdout_attach_failed",
    "last_retried_at": "2026-04-21T..."
  }
}
```

This can live in `continuous-session.json` or governed state, but the implementation must justify the chosen owner before code lands. Continuous-session ownership is likely cleaner because BUG-61 is a continuous/full-auto behavior change, while governed state should keep the existing manual recovery truth.

**Turn 175 Claude Opus 4.7 position on state ownership:** continuous-session.json is the correct owner for the retry counter, BUT the exhaustion outcome must be mirrored into governed state so `agentxchain status` and the dashboard show the truth. Concretely:

- `continuous-session.json::ghost_retry` owns the mutable attempt counter, the last old/new turn ids, and the per-run reset semantics.
- When retry budget is exhausted and the session transitions to `ghost_retry_exhausted`, governed state's `blocked_reason.recovery.detail` must include the attempt count and the exhaustion fact so that non-continuous surfaces (status, dashboard, operator CLI) report accurately even after the continuous process exits.
- Retry state MUST NOT live inside governed state's phase-gate / decision-ledger tables. BUG-62's reconcile path is going to distinguish safe vs unsafe operator commits by what touches governed state; ephemeral recovery metadata there would broaden the unsafe surface needlessly.
- On session resume (new continuous-session.json created for the same run_id via `--continue-from`), retry counters reset to zero. A cold resume is a fresh recovery window. If this produces a real infinite-loop risk in practice, the follow-up is a signature-based early stop (Open Question #2), not a global counter promoted to governed state.

This position should be captured as `DEC-BUG61-GHOST-RETRY-STATE-OWNERSHIP-001` before implementation code lands, per DEC-authoring-before-cli/src/lib-changes.

### Exhaustion Flow

If retry budget is exhausted:

1. Do not call `reissueTurn()`.
2. Preserve the existing blocked governed state.
3. Emit `ghost_retry_exhausted` with:
   - `run_id`
   - `turn_id`
   - `attempts`
   - `max_retries_per_run`
   - `failure_type`
   - `runtime_id`
   - `diagnostic_refs`
4. Keep the continuous session `paused`.
5. Return `status: "blocked"`, `blocked_category: "ghost_turn"`, and a recovery action naming both the existing manual reissue command and the exhausted retry count.

## Error Cases

- **Non-ghost blocker:** no auto-retry; preserve current blocked behavior.
- **Missing active ghost turn:** no auto-retry; emit/return a diagnostic explaining that the blocked reason references a turn that is not in `active_turns`.
- **Missing role or runtime for reissue:** no retry loop; preserve `reissueTurn()` error and pause continuous mode.
- **Retry budget exhausted:** pause and emit `ghost_retry_exhausted`.
- **Repeated same-signature failures:** implementation should stop at the run-scoped retry budget in the first slice. Fingerprint-based early stop is desirable but can be a follow-up if the positive/negative budget tests prove the cap.
- **Budget accounting:** each auto-reissued turn must use the existing `reissueTurn()` reservation path. Do not hand-edit reservations in the continuous loop.
- **Staged result appears after classification:** if a meaningful staged result exists for the old turn before retry, do not auto-retry; defer to the existing accept/reconcile path.

## Acceptance Tests

### Unit / Integration

- `resolveContinuousOptions()` returns default `autoRetryOnGhost.enabled === false`, `maxRetriesPerRun === 3`, and `cooldownSeconds === 5` for continuous mode when the approval_policy posture is NOT full-auto.
- `resolveContinuousOptions()` returns `autoRetryOnGhost.enabled === true` when the approval_policy posture resolves to full-auto (routine gates auto_approve AND phase_transitions.default auto_approve AND run_completion.action auto_approve) AND the config does not set `enabled: false`.
- `--no-auto-retry-on-ghost` CLI flag forces `enabled: false` even under a full-auto posture.
- `--auto-retry-on-ghost` CLI flag forces `enabled: true` even under a non-full-auto posture.
- Explicit `auto_retry_on_ghost.enabled: true` config can opt-in to auto-retry and preserves current manual ghost-block behavior when absent.
- Ghost retry helper returns "retry" only for `blocked_reason.category === "ghost_turn"` plus an active `failed_start` turn with typed startup failure.
- Ghost retry helper returns "do not retry" for stale turns, gate blockers, budget blockers, and credentialed approval blockers.
- Retry budget increments once per auto-reissue and caps at `max_retries_per_run`.

### Command-Chain / E2E

- **Positive:** fake runtime produces two startup ghosts followed by one successful turn. `agentxchain run --continuous` must proceed without operator intervention, emit two `auto_retried_ghost` events, and complete the run.
- **Negative budget cap:** fake runtime produces four consecutive startup ghosts with `max_retries_per_run: 3`. Continuous mode must auto-retry exactly three times, then pause with `ghost_retry_exhausted` and keep the manual recovery command visible.
- **Opt-out:** same fake runtime with `auto_retry_on_ghost.enabled: false` must preserve current behavior: blocked session, manual `reissue-turn --reason ghost` recovery text, zero `auto_retried_ghost` events.
- **Regression:** existing BUG-51/BUG-54 tests must still prove typed `runtime_spawn_failed` vs `stdout_attach_failed`, `failed_start`, startup watchdog threshold, and manual recovery text on non-continuous surfaces.

## Documentation Updates

When implementation lands:

- Update `website-v2/docs/lights-out-operation.mdx` to explain bounded ghost auto-retry and opt-out.
- Update `website-v2/docs/recovery.mdx` or the closest recovery page to distinguish manual ghost recovery from continuous auto-recovery.
- Update release notes with a claim-reality matrix row for:
  - default auto-retry in continuous mode
  - opt-out preserving manual recovery
  - retry exhaustion preserving human-visible diagnostics

## Open Questions

1. Should retry counters live only in `continuous-session.json`, or also be mirrored into governed state for dashboard visibility?
2. ~~Should fingerprint-based early stop ship in the first BUG-61 implementation slice, or is the run-scoped cap sufficient for v1?~~ **RESOLVED Turn 181:** fingerprint-based early stop ships in slice 2c alongside the run-scoped cap. Threshold is a framework constant (`SIGNATURE_REPEAT_THRESHOLD = 2`, not config), fingerprint is `${runtime_id}|${role_id}|${failure_type}`, and the raw-budget check fires before the same-signature check so budget remains the primary cap. Exhaustion event payload carries `exhaustion_reason`, `signature_repeat`, and a `diagnostic_bundle` (attempts_log + fingerprint_summary + final_signature). See `DEC-BUG61-SIGNATURE-REPEAT-EARLY-STOP-001` in `.planning/DECISIONS.md`.
3. ~~Should `auto_retry_on_ghost.enabled` default to true for all continuous sessions, or only when the project has an explicit full-auto policy posture?~~ **RESOLVED Turn 175:** primitive default is `enabled: false`; resolver promotes to `enabled: true` only when the approval_policy resolves to full-auto posture AND continuous is enabled AND the config does not explicitly set `enabled: false`. CLI flags always win. See Default Posture section above.
4. ~~Should `auto_retried_ghost` be added to `VALID_RUN_EVENTS`, and should the dashboard/recent-event summary render it specially?~~ **RESOLVED Turn 179:** `auto_retried_ghost` and `ghost_retry_exhausted` added to `VALID_RUN_EVENTS` in slice 2a. Dashboard/recent-event rendering is deferred to slice 2b docs; no special styling required for v1 — they render as generic run events.
5. **RESOLVED Turn 179:** strict `isFullAutoApprovalPolicy()` detector preserved for v1. BUG-59 generated safe-rule scaffolds (`phase_transitions.default: "require_human"` with explicit `auto_approve` rules) do NOT trigger promotion; those users must opt in via config or `--auto-retry-on-ghost`. See `DEC-BUG61-FULL-AUTO-DETECTOR-STRICT-V1-001` in `.planning/DECISIONS.md`. Slice 2b docs must name this opt-in path explicitly.
