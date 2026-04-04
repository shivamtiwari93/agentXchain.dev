# Hook Audit Invalid Output Spec

## Purpose

Close the `blocked_invalid_output` and `warned_invalid_output` gaps in the `hook_audit` conformance surface.

After HA-001 through HA-007, these two orchestrator_action values remain the next highest-priority untested paths. They exercise the `parseVerdict()` failure branch (line 680-685 of `hook-runner.js`), which fires when a hook exits 0 but produces stdout that is not valid verdict JSON.

## Behavior

`parseVerdict()` returns `null` when:
- stdout is empty or whitespace-only
- stdout is not valid JSON (`JSON.parse` throws)
- parsed value is not an object
- parsed object lacks a `verdict` field from the allowed set (`allow`, `warn`, `block`)

When `parseVerdict()` returns `null`:
- **Blocking mode**: fail-closed. `verdict: "block"`, `orchestrator_action: "blocked_invalid_output"`, pipeline returns `ok: false, blocked: true`.
- **Advisory mode**: warn. `verdict: "warn"`, `orchestrator_action: "warned_invalid_output"`, pipeline returns `ok: true, blocked: false` (advisory failures do not stop execution).

Both cases: `exit_code: 0` (the process succeeded), `timed_out: false`.

## HA-008: Blocking Hook Invalid JSON Output

### Setup

Blocking process hook on `before_assignment` that exits 0 with non-JSON stdout.

### Hook Command

`["node", "-e", "console.log('not valid json')"]`

### Expected

- `hook_ok: false`
- `blocked: true`
- `audit_entry.orchestrator_action: "blocked_invalid_output"`
- `audit_entry.verdict: "block"`
- `audit_entry.exit_code: 0`
- `audit_entry.timed_out: false`
- `audit_entry.hook_name: "bad_output_gate"`
- `audit_entry.transport: "process"`

## HA-009: Advisory Hook Invalid JSON Output

### Setup

Advisory process hook on `before_assignment` that exits 0 with non-JSON stdout.

### Hook Command

`["node", "-e", "console.log('not valid json')"]`

### Expected

- `hook_ok: true` (advisory failures do not block)
- `blocked: false`
- `audit_entry.orchestrator_action: "warned_invalid_output"`
- `audit_entry.verdict: "warn"`
- `audit_entry.exit_code: 0`
- `audit_entry.timed_out: false`
- `audit_entry.hook_name: "bad_output_advisory"`
- `audit_entry.transport: "process"`

## Key Distinction From HA-004 / HA-006

- HA-004 (`blocked_failure`): process exits non-zero. Invalid output is irrelevant.
- HA-006 (`blocked`): process exits 0 with valid JSON `{verdict:"block"}`. Output is well-formed.
- HA-008 (`blocked_invalid_output`): process exits 0 but stdout is not parseable as verdict JSON. This is the fail-closed safety net for malformed hooks.

## No Adapter Changes Required

The existing `run_hooks` case in `reference-conformance-adapter.js` handles this — the hook will execute, `parseVerdict` will return null, and the audit entry will be built with the correct `orchestrator_action`.

## Fixture Counts After

- hook_audit: 9 (HA-001 through HA-009)
- Tier 2: 19 (10 DM + 9 HA)
- Total: 64 (40 T1 + 19 T2 + 5 T3)
