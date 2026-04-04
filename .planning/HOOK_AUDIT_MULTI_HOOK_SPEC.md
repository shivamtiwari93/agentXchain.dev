# Hook Audit Multi-Hook Conformance Spec

## Purpose

Close the next two highest-value `hook_audit` gaps after HA-004 and HA-005:

- the normal blocking verdict path (`orchestrator_action: "blocked"`)
- short-circuit sequencing proof for skipped downstream hooks (`orchestrator_action: "skipped"`)

The existing Tier 2 corpus proves fail-closed process failure, tamper abort, advisory downgrade, and single-hook success paths. It does not yet prove that a valid blocking verdict from one hook both stops the phase and records skipped siblings in audit output.

## Interface

### Adapter response contract

The reference conformance adapter must expose the complete hook audit result set for `run_hooks` fixtures:

```json
{
  "result": "success",
  "hook_ok": false,
  "blocked": true,
  "audit_entry": { "...": "first audit entry for backward compatibility" },
  "audit_entries": [{ "...": "all audit entries in execution order" }]
}
```

`audit_entry` remains for existing single-hook fixtures. `audit_entries` is the normative surface for multi-hook fixtures.

## Behaviors

## HA-006: Explicit Blocking Verdict

### Behavior

A blocking process hook returns valid JSON with `{"verdict":"block"}`. The orchestrator must:

- record `verdict: "block"`
- record `orchestrator_action: "blocked"`
- set `hook_ok: false`
- set `blocked: true`
- stop the phase without requiring timeout or process-failure fallback

### Acceptance Tests

- AT-HA-006-1: `hook_ok === false`
- AT-HA-006-2: `blocked === true`
- AT-HA-006-3: `audit_entry.hook_name === "policy_gate"`
- AT-HA-006-4: `audit_entry.verdict === "block"`
- AT-HA-006-5: `audit_entry.orchestrator_action === "blocked"`
- AT-HA-006-6: `audit_entry.timed_out === false`
- AT-HA-006-7: `audit_entry.exit_code === 0`

## HA-007: Blocking Short-Circuit Records Skipped Hook

### Behavior

Two blocking hooks run in the same phase. The first returns a valid blocking verdict. The orchestrator must:

- record the first hook as `orchestrator_action: "blocked"`
- record the second hook as `orchestrator_action: "skipped"`
- return both entries in `audit_entries` in execution order
- set skipped-entry `duration_ms` to `0`
- set skipped-entry `verdict` to `null`
- preserve `hook_ok: false` and `blocked: true`

### Acceptance Tests

- AT-HA-007-1: `hook_ok === false`
- AT-HA-007-2: `blocked === true`
- AT-HA-007-3: `audit_entries.length === 2`
- AT-HA-007-4: `audit_entries[0].hook_name === "compliance_gate"`
- AT-HA-007-5: `audit_entries[0].orchestrator_action === "blocked"`
- AT-HA-007-6: `audit_entries[1].hook_name === "post_block_should_skip"`
- AT-HA-007-7: `audit_entries[1].orchestrator_action === "skipped"`
- AT-HA-007-8: `audit_entries[1].duration_ms === 0`
- AT-HA-007-9: `audit_entries[1].verdict === null`

## Error Cases

- Existing single-hook fixtures must continue passing unchanged against `audit_entry`.
- Multi-hook fixtures must not assert fields the implementation does not emit on skipped entries. In the current runner, skipped audit entries do not include `transport`; asserting it would be a fixture bug.

## Open Questions

- `blocked_invalid_output`, `warned_invalid_output`, `blocked_timeout`, `warned_timeout`, and `warned_failure` remain uncovered after this slice.

## Fixture Counts After

- Tier 2: 17 (10 dispatch_manifest + 7 hook_audit)
- Total: 62 (40 Tier 1 + 17 Tier 2 + 5 Tier 3)
