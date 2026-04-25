# BUG-75 Spec: Stale Idle-Expansion Run Recovery After BUG-74

## Purpose

Recover active planning runs that were initialized from a `pm_idle_expansion_derived` intake before `agentxchain@2.155.21` and therefore lack `state.charter_materialization_pending`.

BUG-74 fixed the future new-run initialization path. It does not repair already-created dogfood runs. In tusq.dev cycle 03, reissuing the failed PM turn on `agentxchain@2.155.21` still produced a zero-edit phase-transition request because the run state had no pending materialization flag, so the PM prompt never received the "Charter Materialization Required" directive.

## Interface

Recovery applies to runner-owned lifecycle paths that may resume or reissue an already-active run:

- `agentxchain step --resume`
- `agentxchain resume`
- `agentxchain reissue-turn`
- any startup/reconciliation path that loads an active planning run before dispatch

The recovery detector must identify this stale shape:

- `state.status === "active"`
- `state.phase === "planning"`
- `state.charter_materialization_pending` is missing
- run provenance points to an intake intent or intake event whose category is `pm_idle_expansion_derived`
- the active or failed PM turn is being retried, reissued, or replaced after failing semantic planning-gate coverage with no PM-owned gate artifact edits

When the detector can recover the idle-expansion charter from intake context, it must write `state.charter_materialization_pending` using the same schema as BUG-70 and BUG-74:

- `charter`
- `acceptance_contract`
- `source`
- `intent_id`
- `event_id`
- `created_at`

It must also emit an auditable event:

- `type: "charter_materialization_required"`
- `source: "stale_run_recovery"` or equivalent explicit recovery label
- `recovered_missing_flag: true`
- `suppressed_needs_human: false`

## Behavior

1. Fresh `agentxchain@2.155.21+` new-run initialization remains unchanged.
2. Stale active planning runs created before BUG-74 are repaired before the next PM dispatch or reissue prompt is assembled.
3. The repaired PM prompt includes the materialization directive and names the planning gate artifacts the PM must update before requesting implementation.
4. A zero-edit PM transition must not pass merely because the run is stale. Recovery should either:
   - require the current PM turn to modify the PM-owned planning artifacts, or
   - explicitly validate that those artifacts already contain the exact recovered charter before allowing a no-edit transition.
5. The "already materialized" exception, if implemented, must be narrow: it must compare the recovered intake charter against current planning artifacts and must not weaken the BUG-70 semantic-coverage guard for ordinary planning runs.

## Error Cases

- Missing intake intent/event: block with a typed framework recovery error and operator command guidance; do not create a generic human escalation.
- Intake exists but has no recoverable charter: block with a typed framework recovery error.
- Planning artifacts do not match the recovered charter and the PM turn made no PM-owned gate edits: fail semantic coverage as today.
- Non-idle-expansion planning runs: no recovery mutation.
- Runs already containing `charter_materialization_pending`: no duplicate event and no overwrite unless the stored charter is invalid.

## Acceptance Tests

- **AT-BUG75-001:** A fixture with an active planning run created from `pm_idle_expansion_derived` before BUG-74 and no `charter_materialization_pending` is resumed. The runner restores the flag before dispatch and emits `charter_materialization_required` with `recovered_missing_flag: true`.
- **AT-BUG75-002:** Reissuing a failed PM turn on the stale fixture produces a PM prompt containing "Charter Materialization Required" and the recovered charter.
- **AT-BUG75-003:** A zero-edit PM result on the recovered run still fails when the planning gate artifacts do not contain the recovered charter.
- **AT-BUG75-004:** A zero-edit PM result may pass only when the implementation explicitly validates that the current planning artifacts already contain the exact recovered charter and records that validation in history/events.
- **AT-BUG75-005:** A normal active planning run that was not sourced from `pm_idle_expansion_derived` is unchanged by resume/reissue recovery.
- **AT-BUG75-006:** tusq.dev DOGFOOD-EXTENDED cycle 03 recovery on the shipped CLI does not loop on `gate_semantic_coverage` after reissuing the pre-fix PM turn.

## Open Questions

- Should stale-run recovery be invoked only from `reissue-turn`/`step --resume`, or centralized in governed-state loading so every lifecycle command gets the same repair?
- Should the product expose an explicit `repair-run` command for stale framework state, or keep this as an automatic compatibility migration?
