# Protocol v7 Specification

## Purpose

Formalize the v6 extensions (decision carryover, delegation chains with decision contracts, parallel turns, event lifecycle) into constitutional protocol surfaces with conformance fixtures. These capabilities have been implemented, proven, and shipped — but they are not yet part of the conformance verification boundary, which means third-party runners cannot prove they implement them correctly.

## What Changes

### Protocol Version Bump: v6 → v7

The constitutional protocol version moves from `v6` to `v7`. This is a **non-breaking** upgrade: all v6 capabilities remain valid. v7 adds four new conformance surfaces.

### New Conformance Surfaces

All new surfaces are **Tier 1 (Core Constitutional — Mandatory)** because they govern state transitions, acceptance boundaries, and dispatch behavior.

#### Surface: `delegation` (Tier 1)

Fixtures that verify delegation chain semantics:

| Fixture | Type | Description |
|---------|------|-------------|
| DEL-001 | validate | Valid delegation with required fields passes |
| DEL-002 | reject | Delegation with missing `charter` rejected |
| DEL-003 | reject | Delegation with invalid `to_role` pattern rejected |
| DEL-004 | reject | Self-delegation rejected |
| DEL-005 | reject | More than 5 delegations in one turn rejected |
| DEL-006 | reject | Delegation with `run_completion_request` mutual exclusivity rejected |
| DEL-007 | validate | Delegation with `required_decision_ids` passes |
| DEL-008 | reject | Delegation with duplicate `required_decision_ids` rejected |

#### Surface: `decision_carryover` (Tier 1)

Fixtures that verify repo-durable decision semantics:

| Fixture | Type | Description |
|---------|------|-------------|
| DC-001 | validate | Decision with `durability: "repo"` passes validation |
| DC-002 | reject | Decision with invalid durability value rejected |
| DC-003 | validate | Decision with `overrides: "DEC-NNN"` passes when target exists and is active |
| DC-004 | reject | Decision with self-override rejected |
| DC-005 | reject | Decision overriding already-overridden decision rejected |

#### Surface: `parallel_turns` (Tier 1)

Fixtures that verify parallel dispatch semantics:

| Fixture | Type | Description |
|---------|------|-------------|
| PT-001 | validate | Config with `max_concurrent_turns: 2` passes validation |
| PT-002 | reject | Config with `max_concurrent_turns: 0` rejected |
| PT-003 | reject | Config with `max_concurrent_turns: 5` rejected (max is 4) |
| PT-004 | validate | Parallel dispatch fills available slots correctly |

#### Surface: `event_lifecycle` (Tier 1)

Fixtures that verify run event semantics:

| Fixture | Type | Description |
|---------|------|-------------|
| EL-001 | validate | Valid run event with all required fields passes |
| EL-002 | reject | Event with invalid `event_type` rejected |
| EL-003 | validate | `run_started` event is first in timeline |
| EL-004 | validate | `turn_dispatched` precedes `turn_accepted` for same turn |

## Interface

### Version Constants

```javascript
export const CURRENT_PROTOCOL_VERSION = 'v7';
// CURRENT_CONFIG_GENERATION remains 4 (no config schema changes)
```

### Conformance Capabilities

```json
{
  "surfaces": {
    "state_machine": true,
    "turn_result_validation": true,
    "gate_semantics": true,
    "decision_ledger": true,
    "history": true,
    "config_schema": true,
    "dispatch_manifest": true,
    "hook_audit": true,
    "coordinator": true,
    "delegation": true,
    "decision_carryover": true,
    "parallel_turns": true,
    "event_lifecycle": true
  }
}
```

## Behavior

- All existing v6 fixtures continue to pass unchanged
- New v7 surfaces are Tier 1 mandatory
- `agentxchain doctor` and `agentxchain validate` report `protocol v7`
- Conformance verification includes the 4 new surfaces by default
- The conformance fixture count increases from 81 to 102 (21 new fixtures)

## Error Cases

- Runner claiming v7 but failing delegation fixtures → conformance failure
- Runner claiming v7 but failing decision carryover fixtures → conformance failure
- Config with `max_concurrent_turns` outside 1-4 range → validation error (already enforced)

## Acceptance Tests

- AT-V7-001: `CURRENT_PROTOCOL_VERSION` is `'v7'`
- AT-V7-002: `doctor --json` reports `protocol_version: "v7"`
- AT-V7-003: `validate --json` reports `protocol_version: "v7"`
- AT-V7-004: Conformance verification includes `delegation` surface
- AT-V7-005: Conformance verification includes `decision_carryover` surface
- AT-V7-006: Conformance verification includes `parallel_turns` surface
- AT-V7-007: Conformance verification includes `event_lifecycle` surface
- AT-V7-008: All 102 conformance fixtures pass (81 existing + 21 new)
- AT-V7-009: Human-readable doctor output shows `protocol v7`
- AT-V7-010: Protocol reference docs reference v7

## Open Questions

None. The v6 extensions are already implemented, tested, and shipped. This spec only elevates them to conformance-verified status.
