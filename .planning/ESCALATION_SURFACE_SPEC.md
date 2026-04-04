# Escalation Surface Spec

**Status:** shipped

## Purpose

`blocked` state already existed, but escalation was not a first-class operator workflow. The only shipped path into escalation was retry exhaustion, which meant the product claimed an escalation surface without giving operators an explicit way to raise one.

This spec makes escalation a repo-native governed workflow surface:

- operators can raise an escalation intentionally
- governed state records who raised it, what it targets, and how to recover
- the decision ledger records both escalation raise and escalation clear events
- `step` and `resume` recover blocked escalations without requiring manual state edits

This slice does **not** introduce auto-routing, director handoff, paging policy, or approval semantics for escalation resolution.

## Interface

### CLI

```bash
agentxchain escalate --reason <reason> [--detail <detail>] [--action <action>] [--turn <id>]
```

Flags:

- `--reason <reason>`: required operator summary for the escalation
- `--detail <detail>`: optional longer context persisted in recovery metadata
- `--action <action>`: optional override for the recovery action string
- `--turn <id>`: target a specific retained turn when multiple active turns exist

### Governed State

Raising an operator escalation writes:

```json
{
  "status": "blocked",
  "blocked_on": "escalation:operator:{slug}",
  "blocked_reason": {
    "category": "operator_escalation",
    "recovery": {
      "typed_reason": "operator_escalation",
      "owner": "human",
      "recovery_action": "Resolve the escalation, then run agentxchain step [--resume]",
      "turn_retained": true,
      "detail": "..."
    }
  },
  "escalation": {
    "source": "operator",
    "raised_by": "human",
    "from_role": "dev",
    "from_turn_id": "turn_123",
    "reason": "Scope contradiction",
    "detail": "PM and QA acceptance criteria disagree",
    "recovery_action": "Resolve the escalation, then run agentxchain step --resume",
    "escalated_at": "2026-04-04T..."
  }
}
```

`from_role` / `from_turn_id` are nullable when the run has no active turn.

### Decision Ledger

Two new ledger decisions are added:

- `operator_escalated`
- `escalation_resolved`

## Behavior

### 1. Raise Semantics

`agentxchain escalate` is governed-only and may run only when `state.status === "active"`.

The command:

1. resolves the targeted active turn
2. persists blocked state via the existing blocked-state machinery
3. preserves the active turn when one is targeted
4. fires `on_escalation` hooks
5. appends an `operator_escalated` entry to `.agentxchain/decision-ledger.jsonl`

If there is exactly one active turn, it is targeted automatically. If there are multiple active turns, `--turn` is required. If there are no active turns, the escalation is run-level and recovery assigns the next turn after the block is cleared.

### 2. Recovery Action

The default recovery action depends on whether a turn is retained:

- retained turn: `Resolve the escalation, then run agentxchain step --resume`
- no retained turn: `Resolve the escalation, then run agentxchain step`

`--action` may override the recovery string, but it does not change orchestrator behavior.

### 3. Recovery / Reactivation

`step` and `resume` both recover blocked escalation states.

When either command clears a blocked escalation:

1. the run returns to `active`
2. `blocked_on`, `blocked_reason`, and `escalation` are cleared
3. an `escalation_resolved` entry is appended to `.agentxchain/decision-ledger.jsonl`

If a retained turn exists, the same turn is re-dispatched. If no turn is retained, the next governed turn is assigned normally.

### 4. Prefix Semantics

`blocked_on = escalation:operator:{slug}` is distinct from retry exhaustion (`escalation:retries-exhausted:{role}`).

Recovery descriptors and state normalization must preserve that distinction:

- `escalation:operator:*` -> `typed_reason = operator_escalation`
- `escalation:retries-exhausted:*` -> `typed_reason = retries_exhausted`

## Error Cases

- `agentxchain escalate` fails if `--reason` is missing or blank.
- `agentxchain escalate` fails if the run is `idle`, `paused`, `blocked`, or `completed`.
- `agentxchain escalate` fails when multiple active turns exist and `--turn` is omitted.
- `agentxchain escalate --turn <id>` fails if the turn does not exist in `active_turns`.
- Clearing a non-escalation blocked state must not append `escalation_resolved`.

## Acceptance Tests

- `AT-ESC-001`: `agentxchain escalate --reason "..."` on an active run with no active turn writes `status = blocked`, `blocked_on = escalation:operator:*`, and `typed_reason = operator_escalation`.
- `AT-ESC-002`: a single active turn is retained automatically and the recovery action is `agentxchain step --resume`.
- `AT-ESC-003`: multiple active turns require `--turn`.
- `AT-ESC-004`: `--turn` targets the chosen active turn and persists `state.escalation.from_turn_id`.
- `AT-ESC-005`: `step --resume` clears a retained escalation block and appends `decision = escalation_resolved`.
- `AT-ESC-006`: `resume` clears a blocked escalation with no retained turn, assigns the next turn, and appends `decision = escalation_resolved`.
- `AT-ESC-007`: retry-exhaustion escalation still derives `typed_reason = retries_exhausted`, not `operator_escalation`.
- `AT-ESC-008`: CLI docs include the `escalate` command row, flag contract, active-only scope, and recovery semantics.

## Open Questions

1. Should a later slice require an explicit resolution note before an escalation can be cleared?
2. Should future policy support role-routing on escalation (`eng_director`, release manager, human owner) instead of the current human-mediated unblock?
