# Escalation Recovery E2E Spec

**Status:** Shipped
**Decision IDs:** DEC-ESCALATION-E2E-001 through 004

## Purpose

Prove the full escalation → status → resolution → resume cycle through real CLI subprocess execution. The existing escalation tests in `escalate-command.test.js` are unit-level state manipulations. This spec requires subprocess-level proof that the operator recovery path actually works end to end.

## Scope

Two scenarios, both through real `spawnSync` CLI execution:

### Scenario 1: Escalation with retained turn

1. Initialize governed run and assign a turn
2. `agentxchain escalate --reason "..."` blocks the run with turn retained
3. `agentxchain status` shows `operator_escalation` with `step --resume` recovery action and `turn: retained`
4. `agentxchain step --resume` reactivates the run, re-dispatches the retained turn
5. Decision ledger contains both `operator_escalated` and `escalation_resolved` entries

### Scenario 2: Escalation without retained turn (run-level)

1. Initialize governed run, assign a turn, complete it via `accept-turn`
2. `agentxchain escalate --reason "..."` blocks the run with no active turn
3. `agentxchain status` shows `operator_escalation` with `step` recovery action and `turn: cleared`
4. `agentxchain resume` reactivates the run and assigns the next turn
5. Decision ledger contains both `operator_escalated` and `escalation_resolved` entries

## What This Does NOT Prove

- Retry-exhaustion escalation (automatic, not operator-driven)
- Multi-turn escalation targeting with `--turn`
- Hook-triggered escalation
- Escalation during coordinator/multi-repo runs

## Acceptance Tests

| ID | Assertion |
|----|-----------|
| AT-ESC-E2E-001 | `escalate` transitions run from `active` to `blocked` with `blocked_on` starting with `escalation:operator:` |
| AT-ESC-E2E-002 | `status` after escalation shows `typed_reason = operator_escalation`, `owner = human`, and correct recovery action |
| AT-ESC-E2E-003 | `step --resume` after retained-turn escalation reactivates run and re-dispatches the same turn |
| AT-ESC-E2E-004 | `resume` after run-level escalation reactivates run and assigns a new turn |
| AT-ESC-E2E-005 | Decision ledger records `operator_escalated` on escalation and `escalation_resolved` on recovery |
| AT-ESC-E2E-006 | Dispatch bundle is materialized after recovery (PROMPT.md exists) |
| AT-ESC-E2E-007 | Recovery action in `status` matches the actual recovery command used |

## Error Cases

- `escalate` on a non-active run → rejected (already covered by unit tests, not re-proven here)
- `step --resume` when no retained turn exists → rejected (not in scope; covered by unit tests)
