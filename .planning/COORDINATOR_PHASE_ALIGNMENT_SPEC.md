# Coordinator Phase Alignment Spec

> `DEC-COORD-PHASE-ALIGN-001` — coordinator phase order must match child repo routing phase order

---

## Purpose

Fail fast when a multi-repo coordinator declares a phase model that child repos cannot actually execute.

The real bug: `multi init` currently accepts any governed child repo even when the coordinator phases and child repo routing phases diverge. That allows a coordinator to dispatch work into repos whose local run lifecycle cannot satisfy the coordinator's expectations. The most obvious failure mode is a two-phase coordinator (`planning -> implementation`) paired with default governed repos (`planning -> implementation -> qa`), which leaves the child repo unable to complete when the coordinator thinks implementation is final.

This must be rejected during coordinator config load, not discovered later through broken dispatches or E2E fixture hacks.

## Interface

### Validation surface

- File: `cli/src/lib/coordinator-config.js`
- Entry point: `loadCoordinatorConfig(workspacePath)`
- Command surface: `agentxchain multi init`

### Contract

- Derive the coordinator phase order from `agentxchain-multi.json`:
  - use `routing` declaration order when present
  - otherwise use first-seen workstream phase order
- Derive each child repo phase order from `agentxchain.json.routing` declaration order.
- Every child repo referenced by the coordinator must expose the **same ordered phase list** as the coordinator.

## Behavior

1. `loadCoordinatorConfig()` loads and validates `agentxchain-multi.json`.
2. For each resolved governed child repo, read its normalized routing phase order.
3. Compare child repo phase order with coordinator phase order.
4. If the orders differ in membership, order, or length, reject config load with a clear error that names:
   - the repo id
   - the repo phase order
   - the coordinator phase order
5. `agentxchain multi init` must surface that validation failure and refuse to initialize coordinator state.

## Error Cases

| Condition | Behavior |
|---|---|
| Coordinator uses `planning -> implementation`, child repo uses `planning -> implementation -> qa` | Reject config load with phase-alignment error. |
| Coordinator uses `planning -> implementation -> qa`, child repo uses `implementation` only | Reject config load with phase-alignment error. |
| Coordinator omits `routing` but workstreams imply an ordered phase list | Use workstream-derived phase order for comparison. |
| Child repo is not governed | Keep existing `repo_not_governed` failure. Do not mask it as a phase-alignment error. |

## Acceptance Tests

- AT-CPA-001: `loadCoordinatorConfig()` accepts a coordinator when child repo routing phases exactly match the coordinator phase order.
- AT-CPA-002: `loadCoordinatorConfig()` rejects a child repo with an extra phase not present in the coordinator order.
- AT-CPA-003: `loadCoordinatorConfig()` rejects a child repo missing a coordinator phase.
- AT-CPA-004: `agentxchain multi init` surfaces the phase-alignment failure and writes no coordinator state.
- AT-CPA-005: Docs state the phase-order alignment rule for multi-repo coordination and the quickstart no longer implies an invalid default scaffold pairing.

## Open Questions

None. Partial phase overlays are not a supported coordinator contract.
