Status: Active

# BUG-47..50 State Consistency Spec

## Purpose

Close the four continuation/state-consistency defects tracked in `HUMAN-ROADMAP.md`:

- BUG-47 stale running turns are not surfaced or reconciled
- BUG-48 injected-priority marker can outlive the intent it references
- BUG-49 fresh continuation runs do not seed or advance their accepted baseline coherently
- BUG-50 fresh run-history entries must isolate live counters from inherited parent context

## Interface

- `cli/src/lib/stale-turn-watchdog.js`
  - `detectStaleTurns(root, state, config)`
  - `reconcileStaleTurns(root, state, config)`
- `agentxchain status`
- `agentxchain resume`
- `agentxchain step --resume`
- `cli/src/lib/intake.js`
- `cli/src/lib/intent-startup-migration.js`
- `cli/src/lib/governed-state.js`
- `cli/src/lib/run-history.js`

## Behavior

### BUG-47 stale-turn watchdog

- A turn is stale only when all of the following are true:
  - active turn status is `running` or `retrying`
  - `started_at` exceeds the runtime threshold
  - no turn-scoped staged result exists
  - no recent turn-scoped dispatch-progress activity exists
  - no recent turn-scoped durable event exists after the turn started
- Threshold defaults:
  - `local_cli`: 10 minutes
  - `api_proxy`: 5 minutes
  - `run_loop.stale_turn_threshold_ms` overrides both
- Reconciliation is lazy, not daemon-based:
  - `status`
  - `resume`
  - `step --resume`
- Reconciliation transitions the stale turn from `running`/`retrying` to `stalled`, blocks the run, emits `turn_stalled`, and preserves the retained turn for `reissue-turn`.
- `resume` and `step --resume` must fail closed with explicit stale-turn recovery guidance. They must not silently redispatch a stalled turn.

### BUG-48 injected-priority lifecycle

- `injected-priority.json` is valid only while its target intent is still actionable for preemption.
- Actionable marker targets are `approved` or `planned`.
- Any transition writer that moves the referenced intent to a non-actionable state must clear the marker immediately.
- Defensive reads (`status`, run-loop preemption, marker consumption) must also validate the marker against on-disk intent state and auto-clear stale markers.

### BUG-49 continuation accepted baseline

- A fresh run started from `--continue-from` or `--recover-from` seeds `state.accepted_integration_ref` from the current repo HEAD at run initialization.
- `checkpoint-turn` and `accept-turn --checkpoint` must advance `accepted_integration_ref` to the new checkpoint SHA.
- Fresh-run drift calculations therefore compare against the child run's own evolving baseline, not a parent-era or pre-checkpoint SHA.

### BUG-50 run-history isolation

- `run-history.jsonl` computes `phases_completed`, `total_turns`, and `roles_used` from the current run's `history.jsonl` entries only.
- Parent continuity metadata remains visible under a separate nested field and must never alter the child run's live counters.

## Error Cases

- Missing or malformed event/progress/staging files do not crash stale-turn detection; they are treated as absent evidence.
- Missing intent files referenced by a preemption marker cause the marker to be cleared.
- Continuation baseline seeding without git HEAD leaves `accepted_integration_ref` unchanged.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-47-stale-turn-watchdog.test.js`
  - unrelated recent events do not mask a stale turn
  - `resume` and `step --resume` surface stale-turn recovery instead of redispatching
- `cli/test/beta-tester-scenarios/bug-48-intent-lifecycle-contradiction.test.js`
  - reject/suppress/archived-migration paths clear stale markers
  - stale marker is ignored by preemption consumers
- `cli/test/beta-tester-scenarios/bug-49-checkpoint-ref-update.test.js`
  - continuation/recovery run seeds accepted baseline from current HEAD
  - checkpoint updates baseline to new SHA
- `cli/test/beta-tester-scenarios/bug-50-run-history-contamination.test.js`
  - child record counters reflect only child turns
  - inherited parent metadata is stored separately

## Open Questions

- Whether a future watchdog should cover `mcp` or `remote_agent` runtime classes with distinct defaults instead of falling back to the local-cli threshold.
