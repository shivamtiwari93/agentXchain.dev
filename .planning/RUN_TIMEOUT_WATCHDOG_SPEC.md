# Run Timeout & Watchdog Spec

## Purpose

Enable time-bounded governed execution so that lights-out runs cannot stall indefinitely. When a phase or run exceeds its time budget, the system escalates automatically — either blocking the run for operator review or auto-advancing past the stuck phase.

## Motivation

Today, a governed run has no time awareness. If an agent hangs, takes hours on a single turn, or a phase accumulates unbounded work, the only detection mechanism is an operator watching the dashboard. This directly contradicts the lights-out factory vision: **a factory that can't detect stalls is not autonomous.**

## Interface

### Config Shape (`agentxchain.json`)

```json
{
  "timeouts": {
    "per_turn_minutes": 30,
    "per_phase_minutes": 120,
    "per_run_minutes": 480,
    "action": "warn"
  }
}
```

All fields are optional. Omitted fields mean "no timeout."

- `per_turn_minutes`: Maximum wall-clock time for a single turn (assignment to acceptance/rejection). Evaluated at acceptance time by comparing the active turn `started_at` to `now()`.
- `per_phase_minutes`: Maximum wall-clock time in a single phase. Evaluated at each turn acceptance by comparing the phase-entry timestamp to `now()`.
- `per_run_minutes`: Maximum wall-clock time for the entire run. Evaluated at each turn acceptance by comparing `created_at` to `now()`.
- `action`: What happens when a timeout fires.
  - `"escalate"` (default): Block the run with `blocked_on: "timeout:<scope>"` and a structured recovery descriptor. Operator must intervene.
  - `"warn"`: Log a warning in the decision ledger but allow the run to continue. Surfaces in `status`, `report`, and dashboard.

Global `timeouts.action` only supports `"escalate"` and `"warn"`. `skip_phase` is phase-scoped only and must be declared as a routing override.

### Per-Phase Override

```json
{
  "routing": {
    "planning": {
      "entry_role": "pm",
      "timeout_minutes": 60,
      "timeout_action": "skip_phase"
    },
    "implementation": {
      "entry_role": "dev",
      "timeout_minutes": 240
    }
  }
}
```

Phase-level `timeout_minutes` overrides `timeouts.per_phase_minutes` for that specific phase. Phase-level `timeout_action` overrides `timeouts.action`.

`phase_entered_at` is tracked as a top-level governed-state timestamp. It is set when a run is initialized and refreshed whenever a phase transition is approved or auto-advanced.

## Behavior

### Evaluation Points

Timeouts are evaluated at **governed acceptance boundaries** only — not via background polling or daemon processes. This means:

1. **Turn acceptance** (`accept-turn`): Check per-turn, per-phase, and per-run timeouts and mutate governed state when escalation is required.
2. **`status` command**: Report read-only timeout pressure plus persisted timeout-blocked recovery state from state/ledger data.

`approve-transition` and `approve-completion` do not currently re-run timeout mutation. Public docs and tests must not claim those approval commands enforce timeout transitions until the runtime actually does.

This is consistent with the existing checkpoint-at-governance-boundary pattern (`DEC-SESSION-CHECKPOINT-001`).

When a run is paused on `pending_phase_transition` or `pending_run_completion`, `status` still evaluates read-only phase/run timeout pressure. That visibility is advisory only: the timeout will not mutate state until a future `accept-turn`, but the operator must be warned that the elapsed wall clock can already exceed the configured limit.

### Timeout Detection

```
function checkTimeouts(state, config, now) -> TimeoutResult[]
```

Returns an array of `{ scope, exceeded_by_minutes, limit_minutes, action }` for each exceeded timeout.

- `scope`: `"turn"`, `"phase"`, or `"run"`
- `exceeded_by_minutes`: How far past the deadline
- `limit_minutes`: The configured limit
- `action`: `"escalate"`, `"warn"`, or `"skip_phase"`

### Escalation Path

When `action === "escalate"`:

1. Write `blocked_reason` via `buildBlockedReason()` with `category: 'timeout'` and structured `recovery` descriptor.
2. Set `blocked_on: "timeout:turn"`, `"timeout:phase"`, or `"timeout:run"`.
3. Record `{ type: "timeout", scope, limit_minutes, exceeded_by_minutes }` in decision ledger.
4. Recovery action: `agentxchain resume` (clears the timeout block and lets the operator decide whether to continue, skip, or abort).
5. The accepted turn remains accepted. Timeout enforcement is a post-acceptance governance response, not a validation failure.

When `action === "warn"`:

1. Record `{ type: "timeout_warning", scope, limit_minutes, exceeded_by_minutes }` in decision ledger.
2. Surface in `status` output as a warning line.
3. Do not block the run.

When `action === "skip_phase"`:

1. Record `{ type: "timeout_skip", scope: "phase", phase, limit_minutes, exceeded_by_minutes }` in decision ledger.
2. Auto-trigger phase transition (same as approval-policy `auto_approve` path).
3. Phase gate evaluation still runs — if the gate fails, the skip is blocked and escalates instead.

## Error Cases

- `per_turn_minutes` < 1: Config validation error.
- `per_phase_minutes` < 1: Config validation error.
- `per_run_minutes` < `per_phase_minutes`: Config validation warning (not error — the run timeout may fire before a phase completes).
- `timeouts.action: "skip_phase"`: Config validation error. Use `routing.<phase>.timeout_action`.
- Missing `started_at` on active turn: Skip turn-level timeout check (defensive — should never happen in governed runs).
- Missing `created_at` on state: Skip run-level timeout check (defensive).
- Missing `phase_entered_at` on a legacy run already mid-flight: Fall back to `created_at`. This is approximate for non-initial phases and exists for backward compatibility only.

## Acceptance Tests

- `AT-TIMEOUT-001`: Turn timeout fires at acceptance when `started_at` + `per_turn_minutes` < `now()`. Run blocked with `timeout:turn`.
- `AT-TIMEOUT-001A`: Accepted work is preserved when `AT-TIMEOUT-001` fires; the timeout blocks the run after history/ledger/state acceptance, not before.
- `AT-TIMEOUT-002`: Phase timeout fires at acceptance when phase-entry timestamp + `per_phase_minutes` < `now()`. Run blocked with `timeout:phase`.
- `AT-TIMEOUT-002A`: The subprocess CLI surface for `AT-TIMEOUT-002` renders `Reason: timeout`, `Action: agentxchain resume`, and `Detail: Phase timeout (...)`.
- `AT-TIMEOUT-003`: Run timeout fires at acceptance when `created_at` + `per_run_minutes` < `now()`. Run blocked with `timeout:run`.
- `AT-TIMEOUT-003A`: The subprocess CLI surface for `AT-TIMEOUT-003` renders `Reason: timeout`, `Action: agentxchain resume`, and `Detail: Run timeout ...`.
- `AT-TIMEOUT-004`: `action: "warn"` logs to decision ledger but does not block.
- `AT-TIMEOUT-005`: `action: "skip_phase"` auto-advances and records the skip in the ledger.
- `AT-TIMEOUT-006`: Per-phase `timeout_minutes` override takes precedence over global `per_phase_minutes`.
- `AT-TIMEOUT-007`: `skip_phase` blocked by failing phase gate escalates to `escalate` action.
- `AT-TIMEOUT-008`: `status` command shows timeout warning when deadline is exceeded.
- `AT-TIMEOUT-009`: `report` includes timeout events from decision ledger.
- `AT-TIMEOUT-010`: Recovery from timeout block via `resume` clears the block and allows continuation.
- `AT-TIMEOUT-011`: Config validation rejects `timeouts.action: "skip_phase"` and allows it only as a phase routing override.
- `AT-TIMEOUT-012`: Blocked recovery descriptor has `typed_reason: 'timeout'` with scope, limit, and recovery action.
- `AT-TIMEOUT-015`: `status` surfaces read-only phase/run timeout pressure during approval waits and explicitly warns that the next accepted turn may block.

## Open Questions

1. Should `per_turn_minutes` be evaluated at dispatch time (preemptive) or only at acceptance time (retrospective)? Dispatch-time would require the dispatcher to set a deadline, which is more complex but catches stalls earlier.
2. Should there be a `per_turn_minutes` per-role override? E.g., QA roles might need longer than dev roles.
3. Should timeout warnings appear in the dashboard? (Likely yes, but the dashboard component is a separate slice.)

## Approval-Pending Exemption

Timeout enforcement does **not** apply to runs paused on human approval gates (`pending_phase_transition` or `pending_run_completion`).

### Rationale

- Pending approval states are explicit governance pauses where the human is sovereign (VISION.md: "Humans remain sovereign").
- No agent work happens during an approval wait — no cost accrues, no drift occurs.
- Timing out a pending approval would punish operators for not responding instantly, undermining the governance model.
- `skip_phase` already cannot bypass gates that still require human approval — the runtime already protects this boundary.
- If an organization wants approval SLAs (e.g., "approvals must happen within 4 hours"), that is a notification/reminder concern, not a timeout-block concern. A future `approval_sla` config surface could handle that independently.

### Invariant

`evaluateTimeouts()` is only called from `acceptGovernedTurn()`. It is never called from `approvePhaseTransition()` or `approveRunCompletion()`. This call-site restriction is the structural guarantee that approval-pending state cannot trigger timeout mutation. Public docs, specs, and tests must not claim otherwise.

### Decision

`DEC-APPROVAL-TIMEOUT-EXEMPT-001`: Approval-pending states (`pending_phase_transition`, `pending_run_completion`) are exempt from timeout enforcement. Timeouts evaluate only at the `accept-turn` boundary. Approval commands do not re-run timeout mutation. If approval SLA enforcement is needed in the future, it must be a separate config surface, not a timeout extension.

### Acceptance Tests

- `AT-TIMEOUT-013`: `approve-transition` does not call `evaluateTimeouts()` and does not block on timeout even when `per_phase_minutes` is exceeded.
- `AT-TIMEOUT-014`: `approve-completion` does not call `evaluateTimeouts()` and does not block on timeout even when `per_run_minutes` is exceeded.

## Relationship To Existing Mechanisms

- **Budget enforcement**: Budget caps spend; timeouts cap time. Both are governance boundaries that fire at acceptance. They compose naturally.
- **Approval policy**: Approval policy relaxes human gates; timeouts enforce time gates. They are orthogonal — a timeout can fire on a run that has approval policy auto-approving transitions.
- **Session checkpoint**: Checkpoints record governance-boundary state; timeouts evaluate at the same boundaries. Timeout events should be captured in checkpoint state.
- **Recovery descriptors**: Timeout blocks use the same `buildBlockedReason` / `deriveRecoveryDescriptor` infrastructure as policy escalation, hook blocking, etc.
