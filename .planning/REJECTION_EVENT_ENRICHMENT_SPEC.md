# Rejection Event Payload Enrichment Spec

## Purpose

Enrich `turn_rejected` events in `events.jsonl` with rejection details (`reason`, `failed_stage`, `validation_errors`) so the event stream serves as a complete audit trail without requiring operators to cross-reference `state.json`.

## Problem

Before this change, `turn_rejected` events carried only `{ attempt, retrying, escalated? }`. Operators monitoring via `agentxchain events` or reading `events.jsonl` could see _that_ a turn was rejected but not _why_. To answer "why was this turn rejected?" they had to read `.agentxchain/state.json` → `active_turns[].last_rejection`.

## Interface

No new commands or config. The `turn_rejected` event payload is enriched:

### Before

```json
{
  "event_type": "turn_rejected",
  "payload": { "attempt": 1, "retrying": true }
}
```

### After

```json
{
  "event_type": "turn_rejected",
  "payload": {
    "attempt": 1,
    "retrying": true,
    "reason": "Schema mismatch",
    "failed_stage": "schema",
    "validation_errors": ["Missing required field: schema_version"]
  }
}
```

## Behavior

1. Both retry and escalation `turn_rejected` event emissions include `reason` and `failed_stage` from the already-constructed `rejectionContext`.
2. `validation_errors` is included only when non-empty (conditional spread).
3. The `events` command text output now shows `reason` and `failed_stage` inline for `turn_rejected` events.
4. `events --json` inherits the enrichment automatically (raw event passthrough).

## Error Cases

- Missing `rejectionContext.reason`: falls through to the existing default (`'Validation failed'` or `'file_conflict'`).
- Empty `validation_errors`: omitted from payload entirely, not serialized as `[]`.

## Acceptance Tests

- [x] Retry `turn_rejected` event carries `reason`, `failed_stage`, and `validation_errors`
- [x] Escalation `turn_rejected` event carries `reason`, `failed_stage`, and `validation_errors`
- [x] Empty `validation_errors` are omitted from the event payload
- [x] `agentxchain events` text output renders rejection `reason` and `failed_stage` inline for `turn_rejected`
- [x] Existing reject/retry E2E tests pass without regression

## Trust Assumption

Event payloads contain the same data as `state.json` `last_rejection`. This is not a new trust surface — it surfaces existing rejection context through the event stream.

## Decisions

- `DEC-REJECTION-EVENT-001`: `turn_rejected` events must carry `reason` and `failed_stage` from `rejectionContext`. The event stream is an audit trail, not a notification stub.
